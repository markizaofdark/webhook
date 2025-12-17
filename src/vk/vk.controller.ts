import { Controller, Post, Get, Body, Query, Logger, HttpCode } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VkService } from './vk.service';
import { ApiService } from './api.service';

@Controller('vk')
export class VkController {
  private readonly logger = new Logger(VkController.name);
  private readonly vkConfirmation: string;
  private readonly vkGroupId: number;

  constructor(
    private readonly vkService: VkService,
    private readonly apiService: ApiService,
    private readonly configService: ConfigService,
  ) {
    this.vkConfirmation = this.configService.get<string>('VK_CONFIRMATION');
    this.vkGroupId = parseInt(this.configService.get<string>('VK_GROUP_ID', '0'));
  }

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Body() body: any,
    @Query() query: any,
  ): Promise<string> {
    this.logger.debug('Received VK callback');

    const eventType = body.type || query.type;

    // 1. Confirmation
    if (eventType === 'confirmation') {
      this.logger.log(`Returning confirmation code: ${this.vkConfirmation}`);
      return this.vkConfirmation;
    }

    // 2. Проверка group_id
    if (body.group_id && parseInt(body.group_id) !== this.vkGroupId) {
      this.logger.warn(`Invalid group_id: ${body.group_id}, expected: ${this.vkGroupId}`);
      return 'ok';
    }

    // 3. Обработка событий
    try {
      switch (eventType) {
        case 'message_new':
          await this.handleMessageNew(body.object);
          break;
          
        case 'message_reply':
          this.logger.log('Message reply received');
          break;
          
        case 'message_allow':
          this.logger.log(`User ${body.object.user_id} allowed messages`);
          break;
          
        case 'message_deny':
          this.logger.log(`User ${body.object.user_id} denied messages`);
          break;
          
        case 'group_join':
          this.logger.log(`User ${body.object.user_id} joined group`);
          break;
          
        case 'group_leave':
          this.logger.log(`User ${body.object.user_id} left group`);
          break;
          
        case 'message_typing_state':
          // Просто логируем, не обрабатываем
          this.logger.debug('Message typing state event received');
          break;
          
        default:
          this.logger.log(`Unhandled event type: ${eventType}`);
      }
    } catch (error) {
      this.logger.error(`Error processing ${eventType}:`, error.message);
    }

    return 'ok';
  }

  private async handleMessageNew(messageData: any): Promise<void> {
    try {
      const message = messageData.message;
      const vkUserId = message.from_id;
      const messageText = message.text || '';
      
      this.logger.log(`Processing message from ${vkUserId}: ${messageText.substring(0, 100)}...`);

      // Получаем информацию о пользователе
      const userInfo = await this.vkService.getVkUserInfo(vkUserId);
      
      // Создаем или получаем контакт
      const contactId = await this.apiService.getOrCreateContact(vkUserId, userInfo);
      
      if (!contactId) {
        this.logger.error(`Failed to get/create contact for VK user ${vkUserId}`);
        return;
      }
      
      // Создаем или получаем беседу
      const conversationId = await this.apiService.getOrCreateConversation(vkUserId, contactId);
      
      if (!conversationId) {
        this.logger.error(`Failed to get/create conversation for contact ${contactId}`);
        return;
      }
      
      // Отправляем сообщение в Chatwoot
      const messageSent = await this.apiService.sendMessage(conversationId, messageText);
      
      if (messageSent) {
        this.logger.log(`Successfully processed message from ${vkUserId}`);
      } else {
        this.logger.error(`Failed to send message from ${vkUserId} to Chatwoot`);
      }
      
    } catch (error) {
      this.logger.error('Error in handleMessageNew:', error.message, error.stack);
    }
  }

  @Get('health')
  async healthCheck(): Promise<any> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      vk_group_id: this.vkGroupId,
      webhook_url: `${this.configService.get('WEBHOOK_URL', '')}/vk/callback`,
    };
  }

  @Post('test')
  async testIntegration(@Body() testData: any): Promise<any> {
    try {
      const vkUserId = testData.user_id || 506175275;
      const messageText = testData.message || 'Test message from VK';
      
      this.logger.log(`Test: Processing message from ${vkUserId}`);
      
      // Имитация VK callback
      const mockEvent = {
        type: 'message_new',
        object: {
          message: {
            id: Date.now(),
            from_id: vkUserId,
            peer_id: vkUserId,
            text: messageText,
            date: Math.floor(Date.now() / 1000),
          },
        },
        group_id: this.vkGroupId,
      };
      
      await this.handleMessageNew(mockEvent.object);
      
      return {
        status: 'success',
        message: 'Test completed',
        user_id: vkUserId,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  @Get('test-chatwoot')
async testChatwootConnection(): Promise<any> {
  try {
    const testResult = await this.apiService.testConnection();
    
    if (testResult) {
      return {
        status: 'success',
        message: 'Chatwoot API connection is working',
        timestamp: new Date().toISOString(),
      };
    } else {
      return {
        status: 'error',
        message: 'Failed to connect to Chatwoot API',
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}
}
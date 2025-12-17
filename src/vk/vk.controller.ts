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
    this.logger.debug('VK callback received');

    const eventType = body.type || query.type;

    // Confirmation
    if (eventType === 'confirmation') {
      this.logger.log(`Returning confirmation: ${this.vkConfirmation}`);
      return this.vkConfirmation;
    }

    // Проверка group_id
    if (body.group_id && parseInt(body.group_id) !== this.vkGroupId) {
      this.logger.warn(`Wrong group_id: ${body.group_id}`);
      return 'ok';
    }

    // Обработка событий
    try {
      switch (eventType) {
        case 'message_new':
          await this.handleMessageNew(body.object);
          break;
          
        case 'message_typing_state':
          // Игнорируем
          break;
          
        default:
          this.logger.log(`Unhandled event: ${eventType}`);
      }
    } catch (error) {
      this.logger.error(`Error: ${eventType}:`, error.message);
    }

    return 'ok';
  }

  private async handleMessageNew(messageData: any): Promise<void> {
    try {
      const message = messageData.message;
      const vkUserId = message.from_id;
      const messageText = message.text || '';
      
      this.logger.log(`Message from ${vkUserId}: ${messageText.substring(0, 100)}...`);

      // Получаем информацию о пользователе
      const userInfo = await this.vkService.getVkUserInfo(vkUserId);
      
      // Создаем или получаем контакт в Chatwoot
      const contactId = await this.apiService.getOrCreateContact(vkUserId, userInfo);
      
      if (!contactId) {
        this.logger.error(`No contact ID for ${vkUserId}`);
        return;
      }
      
      // Создаем или получаем беседу
      const conversationId = await this.apiService.getOrCreateConversation(vkUserId, contactId);
      
      if (!conversationId) {
        this.logger.error(`No conversation ID for contact ${contactId}`);
        return;
      }
      
      // Отправляем сообщение
      const sent = await this.apiService.sendMessage(conversationId, messageText);
      
      if (sent) {
        this.logger.log(`Message from ${vkUserId} sent to Chatwoot`);
      } else {
        this.logger.error(`Failed to send message from ${vkUserId}`);
      }
      
    } catch (error) {
      this.logger.error('Error processing message:', error.message, error.stack);
    }
  }

  @Get('test')
  async testApi(): Promise<any> {
    try {
      // Тестовый запрос к Chatwoot API
      const testUrl = 'https://guiai-test.ru/api/v1/accounts/1/inboxes';
      const response = await this.apiService['httpService'].get(testUrl, {
        headers: {
          'api_access_token': this.configService.get('API_TOKEN'),
          'Content-Type': 'application/json',
        },
      }).toPromise();

      return {
        status: 'success',
        data: response.data,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        response: error.response?.data,
      };
    }
  }

  @Post('send-test')
  async sendTestMessage(@Body() body: any): Promise<any> {
    try {
      const vkUserId = body.user_id || 506175275;
      const messageText = body.message || 'Test message';
      
      this.logger.log(`Sending test message for user ${vkUserId}`);
      
      // Имитируем VK callback
      await this.handleMessageNew({
        message: {
          from_id: vkUserId,
          text: messageText,
        },
      });
      
      return {
        status: 'success',
        message: 'Test message processed',
        user_id: vkUserId,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  @Get('status')
  async getStatus(): Promise<any> {
    return {
      status: 'online',
      timestamp: new Date().toISOString(),
      vk_group_id: this.vkGroupId,
      webhook_url: `${this.configService.get('WEBHOOK_URL', '')}/vk/callback`,
      endpoints: {
        test: `${this.configService.get('WEBHOOK_URL', '')}/vk/test`,
        send_test: `${this.configService.get('WEBHOOK_URL', '')}/vk/send-test`,
      },
    };
  }
}
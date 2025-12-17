import { Controller, Post, Get, Body, Query, Headers, Logger, HttpCode } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VkService } from './vk.service';
import { ApiService } from './api.service';

@Controller('vk')
export class VkController {
  private readonly logger = new Logger(VkController.name);
  private readonly vkConfirmation: string;
  private readonly vkGroupId: number;
  private readonly vkSecret: string;

  constructor(
    private readonly vkService: VkService,
    private readonly apiService: ApiService,
    private readonly configService: ConfigService,
  ) {
    this.vkConfirmation = this.configService.get<string>('VK_CONFIRMATION');
    this.vkGroupId = parseInt(this.configService.get<string>('VK_GROUP_ID'));
    this.vkSecret = this.configService.get<string>('VK_SECRET');
  }

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Body() body: any,
    @Query() query: any,
  ): Promise<string> {
    this.logger.debug('Received VK callback:', { body, query });

    const eventType = body.type || query.type;

    // 1. Confirmation для Callback API
    if (eventType === 'confirmation') {
      this.logger.log(`Returning confirmation code: ${this.vkConfirmation}`);
      return this.vkConfirmation;
    }

    // 2. Проверка secret (если настроен)
    if (this.vkSecret && body.secret !== this.vkSecret) {
      this.logger.warn('Invalid secret key provided');
      return 'ok'; // Все равно возвращаем ok, чтобы VK не спамил
    }

    // 3. Проверка group_id
    if (body.group_id && parseInt(body.group_id) !== this.vkGroupId) {
      this.logger.warn(`Invalid group_id: ${body.group_id}, expected: ${this.vkGroupId}`);
      return 'ok';
    }

    // 4. Обработка событий
    try {
      switch (eventType) {
        case 'message_new':
          await this.handleMessageNew(body.object);
          break;
          
        case 'message_reply':
          this.logger.log('Message reply received:', body.object);
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
      
      // Создаем или получаем беседу
      const conversationId = await this.apiService.getOrCreateConversation(vkUserId, contactId);
      
      // Отправляем сообщение в Chatwoot
      await this.apiService.sendMessage(conversationId, messageText, 'incoming');
      
      this.logger.log(`Successfully processed message from ${vkUserId}`);
      
    } catch (error) {
      this.logger.error('Error in handleMessageNew:', error.message, error.stack);
    }
  }

  @Get('test')
  async testEndpoint(): Promise<any> {
    return {
      status: 'online',
      timestamp: new Date().toISOString(),
      webhook_url: `${this.configService.get('WEBHOOK_URL')}/vk/callback`,
      vk_group_id: this.vkGroupId,
    };
  }
}
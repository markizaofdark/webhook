import { Controller, Post, Get, Body, Query, Headers, Logger, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VkService } from './vk.service';
import { ApiService } from './api.service';

interface VkCallbackEvent {
  type: string;
  object: any;
  group_id: number;
  secret?: string;
}

interface VkMessageNew {
  message: {
    id: number;
    from_id: number;
    peer_id: number;
    text: string;
    date: number;
    attachments?: any[];
  };
}

@Controller('vk')
export class VkController {
  private readonly logger = new Logger(VkController.name);
  private readonly vkConfirmation: string;
  private readonly vkGroupId: string;
  private readonly webhookUrl: string;

  constructor(
    private readonly vkService: VkService,
    private readonly apiService: ApiService,
    private readonly configService: ConfigService,
  ) {
    this.vkConfirmation = this.configService.get<string>('VK_CONFIRMATION');
    this.vkGroupId = this.configService.get<string>('VK_GROUP_ID');
    this.webhookUrl = this.configService.get<string>('WEBHOOK_URL', 'https://my-bot.loca.lt');
  }

  /**
   * Эндпоинт для Callback API VK
   * VK будет отправлять запросы на: https://my-bot.loca.lt/vk/callback
   */
  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Body() body: VkCallbackEvent,
    @Query() query: any,
    @Headers() headers: any,
  ): Promise<string | { status: string }> {
    this.logger.debug(`Received VK callback: ${JSON.stringify(body)}`);
    this.logger.debug(`Query params: ${JSON.stringify(query)}`);

    try {
      // VK может отправлять данные как в body, так и в query для confirmation
      const eventType = body.type || query.type;

      // 1. Подтверждение сервера
      if (eventType === 'confirmation') {
        this.logger.log(`Confirmation requested. Returning: ${this.vkConfirmation}`);
        return this.vkConfirmation;
      }

      // 2. Проверка секретного ключа (если настроен)
      if (body.secret && body.secret !== this.configService.get<string>('VK_SECRET')) {
        this.logger.warn('Invalid secret key');
        throw new HttpException('Invalid secret', HttpStatus.FORBIDDEN);
      }

      // 3. Проверка group_id
      if (body.group_id && parseInt(body.group_id.toString()) !== parseInt(this.vkGroupId)) {
        this.logger.warn(`Invalid group_id: ${body.group_id}`);
        throw new HttpException('Invalid group_id', HttpStatus.BAD_REQUEST);
      }

      // 4. Обработка событий
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

        default:
          this.logger.log(`Unhandled event type: ${eventType}`);
      }

      // Всегда возвращаем 'ok' для VK
      return 'ok';

    } catch (error) {
      this.logger.error(`Error processing callback: ${error.message}`, error.stack);
      
      // Все равно возвращаем 'ok', чтобы VK не считал запрос неудачным
      // Но в реальном приложении нужно учитывать логику повторных отправок
      return 'ok';
    }
  }

  /**
   * Обработка нового сообщения
   */
  private async handleMessageNew(messageData: VkMessageNew): Promise<void> {
    try {
      const message = messageData.message;
      const vkUserId = message.from_id;
      const messageText = message.text || '';
      const messageId = message.id;

      this.logger.log(`New message from ${vkUserId}: ${messageText.substring(0, 50)}...`);

      // Получаем информацию о пользователе
      const userInfo = await this.vkService.getVkUserInfo(vkUserId);
      
      // Создаем или получаем контакт
      const contactId = await this.apiService.getOrCreateContact(vkUserId, userInfo);
      
      // Создаем или получаем диалог
      const conversationId = await this.apiService.getOrCreateConversation(vkUserId, contactId);
      
      // Отправляем сообщение в систему
      await this.apiService.sendMessage(conversationId, messageText, 'incoming');

      this.logger.log(`Message ${messageId} processed successfully`);

    } catch (error) {
      this.logger.error(`Error handling message_new: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Эндпоинт для проверки работоспособности вебхука
   */
  @Get('callback')
  @HttpCode(200)
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): Promise<string> {
    this.logger.log(`Webhook verification request: mode=${mode}, token=${token}`);

    // Если используется Facebook Webhook Verification (пример)
    if (mode === 'subscribe' && token === this.vkConfirmation) {
      return challenge;
    }

    // Для VK просто показываем информацию
    return 'VK Callback API is active. Use POST /vk/callback for events.';
  }

  /**
   * Эндпоинт для тестирования вебхука
   */
  @Post('test-webhook')
  @HttpCode(200)
  async testWebhook(@Body() testData: any): Promise<any> {
    this.logger.log('Test webhook received:', testData);

    try {
      // Имитация VK callback для тестирования
      const mockEvent: VkCallbackEvent = {
        type: 'message_new',
        object: {
          message: {
            id: Math.floor(Math.random() * 1000000),
            from_id: testData.user_id || 123456,
            peer_id: testData.user_id || 123456,
            text: testData.message || 'Test message',
            date: Math.floor(Date.now() / 1000),
          },
        },
        group_id: parseInt(this.vkGroupId),
      };

      await this.handleCallback(mockEvent, {}, {});
      
      return {
        status: 'success',
        message: 'Test webhook processed successfully',
        webhook_url: `${this.webhookUrl}/vk/callback`,
      };
    } catch (error) {
      this.logger.error('Test webhook error:', error);
      throw new HttpException(
        {
          status: 'error',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Эндпоинт для получения информации о вебхуке
   */
  @Get('info')
  @HttpCode(200)
  async getWebhookInfo(): Promise<any> {
    return {
      status: 'active',
      webhook_url: `${this.webhookUrl}/vk/callback`,
      group_id: this.vkGroupId,
      supported_events: [
        'message_new',
        'message_reply',
        'message_allow',
        'message_deny',
        'group_join',
        'group_leave',
      ],
      test_endpoint: `${this.webhookUrl}/vk/test-webhook`,
      verification_endpoint: `${this.webhookUrl}/vk/callback`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Эндпоинт для получения списка событий (для отладки)
   */
  @Get('events')
  @HttpCode(200)
  async getRecentEvents(): Promise<any> {
    // В реальном приложении здесь можно возвращать события из базы данных
    return {
      status: 'ok',
      message: 'Event logging not implemented. Use monitoring/logs.',
    };
  }
}
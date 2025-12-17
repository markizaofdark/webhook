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

  /**
   * Эндпоинт для Callback API VK
   */
  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Body() body: any,
    @Query() query: any,
  ): Promise<string> {
    this.logger.debug('VK callback received');

    const eventType = body.type || query.type;

    // Confirmation для VK
    if (eventType === 'confirmation') {
      this.logger.log(`Returning confirmation code: ${this.vkConfirmation}`);
      return this.vkConfirmation;
    }

    // Проверка group_id
    if (body.group_id && parseInt(body.group_id) !== this.vkGroupId) {
      this.logger.warn(`Invalid group_id: ${body.group_id}, expected: ${this.vkGroupId}`);
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
      this.logger.error(`Error processing ${eventType}:`, error.message);
    }

    return 'ok';
  }

  /**
   * Обработка нового сообщения из VK
   */
  private async handleMessageNew(messageData: any): Promise<void> {
    try {
      const message = messageData.message;
      const vkUserId = message.from_id;
      const messageText = message.text || '';
      
      this.logger.log(`Processing message from ${vkUserId}: ${messageText.substring(0, 100)}...`);

      // Получаем информацию о пользователе VK
      const userInfo = await this.vkService.getVkUserInfo(vkUserId);
      
      // Используем комплексный метод ApiService
      const success = await this.apiService.processVkMessage(vkUserId, userInfo, messageText);
      
      if (success) {
        this.logger.log(`Message from ${vkUserId} successfully sent to Chatwoot`);
      } else {
        this.logger.error(`Failed to process message from ${vkUserId}`);
      }
      
    } catch (error) {
      this.logger.error('Error in handleMessageNew:', error.message, error.stack);
    }
  }

  /**
   * Тестовый эндпоинт для ручной проверки
   */
  @Post('test')
  async testIntegration(@Body() testData: any): Promise<any> {
    try {
      const vkUserId = testData.user_id || 506175275;
      const messageText = testData.message || 'Test message from VK integration';
      
      this.logger.log(`Manual test for user ${vkUserId}: ${messageText}`);
      
      const userInfo = await this.vkService.getVkUserInfo(vkUserId);
      const success = await this.apiService.processVkMessage(vkUserId, userInfo, messageText);
      
      return {
        status: success ? 'success' : 'error',
        message: success ? 'Test message processed through Chatwoot API' : 'Failed to process test message',
        user_id: vkUserId,
        api_type: 'application',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Тестирование Chatwoot API соединения
   */
  @Post('test-chatwoot')
  async testChatwootConnection(): Promise<any> {
    try {
      const connected = await this.apiService.testConnection();
      
      return {
        status: connected ? 'success' : 'error',
        message: connected ? 'Chatwoot API connection is working' : 'Failed to connect to Chatwoot API',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Статус сервера
   */
  @Get('status')
  async getStatus(): Promise<any> {
    const chatwootTest = await this.apiService.testConnection();
    
    return {
      status: 'online',
      timestamp: new Date().toISOString(),
      vk: {
        group_id: this.vkGroupId,
        confirmation_code_set: !!this.vkConfirmation,
      },
      chatwoot: {
        connected: chatwootTest,
        base_url: this.configService.get('API_BASE_URL'),
        account_id: this.configService.get('ACCOUNT_ID'),
        inbox_id: this.configService.get('INBOX_ID'),
        api_type: 'application',
        auth_method: 'query_parameter',
      },
      server: {
        webhook_url: `${this.configService.get('WEBHOOK_URL', '')}/vk/callback`,
        environment: this.configService.get('NODE_ENV'),
      },
      endpoints: {
        vk_callback: `${this.configService.get('WEBHOOK_URL', '')}/vk/callback`,
        test: `${this.configService.get('WEBHOOK_URL', '')}/vk/test`,
        test_chatwoot: `${this.configService.get('WEBHOOK_URL', '')}/vk/test-chatwoot`,
        status: `${this.configService.get('WEBHOOK_URL', '')}/vk/status`,
      }
    };
  }

  @Get('health')
  healthCheck(): any {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'vk-chatwoot-integration',
    };
  }
}
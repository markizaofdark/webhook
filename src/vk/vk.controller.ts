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

    // Confirmation для Callback API
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

      // Получаем информацию о пользователе из VK
      const userInfo = await this.vkService.getVkUserInfo(vkUserId);
      const userName = `${userInfo.first_name} ${userInfo.last_name}`.trim();
      
      // Отправляем сообщение через Chatwoot Widget API
      const success = await this.apiService.sendMessageViaWidget(
        vkUserId,
        userName,
        messageText
      );
      
      if (success) {
        this.logger.log(`Successfully sent message from ${vkUserId} to Chatwoot`);
      } else {
        this.logger.error(`Failed to send message from ${vkUserId} to Chatwoot`);
      }
      
    } catch (error) {
      this.logger.error('Error in handleMessageNew:', error.message, error.stack);
    }
  }

  /**
   * Тестовый endpoint для проверки Chatwoot Widget API
   */
  @Post('test-widget')
  async testWidget(@Body() testData: any): Promise<any> {
    try {
      const vkUserId = testData.user_id || 506175275;
      const userName = testData.name || 'Test User';
      const messageText = testData.message || 'Test message from VK';
      
      this.logger.log(`Testing Chatwoot widget API for user ${vkUserId}`);
      
      const success = await this.apiService.sendMessageViaWidget(
        vkUserId,
        userName,
        messageText
      );
      
      return {
        status: success ? 'success' : 'error',
        message: success ? 'Message sent to Chatwoot via widget API' : 'Failed to send message',
        user_id: vkUserId,
        inbox_identifier: this.configService.get('INBOX_IDENTIFIER'),
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  /**
   * Диагностика
   */
  @Get('diagnostics')
  async diagnostics(): Promise<any> {
    return {
      status: 'online',
      timestamp: new Date().toISOString(),
      vk_group_id: this.vkGroupId,
      chatwoot: {
        base_url: 'https://guiai-test.ru',
        inbox_identifier: this.configService.get('INBOX_IDENTIFIER') ? 'SET' : 'NOT SET',
        inbox_id: this.configService.get('INBOX_ID'),
      },
      webhook_url: `${this.configService.get('WEBHOOK_URL', '')}/vk/callback`,
      endpoints: {
        test_widget: `${this.configService.get('WEBHOOK_URL', '')}/vk/test-widget`,
        health: `${this.configService.get('WEBHOOK_URL', '')}/vk/health`,
      }
    };
  }

  @Get('health')
  healthCheck(): any {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
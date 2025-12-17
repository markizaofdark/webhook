import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);
  
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.logger.log('Chatwoot Widget API Service initialized');
  }

  /**
   * Отправка сообщения через Chatwoot Widget API
   * Документация: https://www.chatwoot.com/docs/product/channels/api/widget-api
   */
  async sendMessageViaWidget(vkUserId: number, userName: string, messageText: string): Promise<boolean> {
    try {
      const inboxIdentifier = this.configService.get<string>('INBOX_IDENTIFIER');
      const baseUrl = 'https://guiai-test.ru'; // Без /api/v1!
      
      // URL для виджета Chatwoot
      const widgetUrl = `${baseUrl}/api/v1/widget/messages`;
      
      this.logger.log(`Sending message to Chatwoot widget for VK user ${vkUserId}`);
      
      const messageData = {
        website_token: inboxIdentifier, // Это ваш INBOX_IDENTIFIER!
        contact: {
          identifier: `vk_${vkUserId}`,
          name: userName,
          email: `vk_${vkUserId}@vk.com`,
          phone_number: null,
          avatar_url: null,
          custom_attributes: {
            vk_id: vkUserId.toString(),
            source: 'vk_messenger'
          }
        },
        message: {
          content: messageText,
          timestamp: new Date().toISOString(),
          message_type: 'incoming'
        }
      };

      this.logger.debug(`Widget API request:`, {
        url: widgetUrl,
        data: messageData
      });

      const response = await firstValueFrom(
        this.httpService.post(widgetUrl, messageData, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }),
      );

      this.logger.log(`Message sent via widget API for VK user ${vkUserId}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to send message via widget:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url
      });
      return false;
    }
  }

  /**
   * Получение информации о контакте через виджет
   */
  async getContactViaWidget(vkUserId: number): Promise<any> {
    try {
      const inboxIdentifier = this.configService.get<string>('INBOX_IDENTIFIER');
      const baseUrl = 'https://guiai-test.ru';
      const widgetUrl = `${baseUrl}/api/v1/widget/contacts`;
      
      const response = await firstValueFrom(
        this.httpService.post(widgetUrl, {
          website_token: inboxIdentifier,
          identifier: `vk_${vkUserId}`
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get contact via widget:`, error.message);
      return null;
    }
  }
}
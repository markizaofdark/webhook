import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

interface VkUser {
  id: number;
  first_name: string;
  last_name: string;
  photo_100?: string;
}

@Injectable()
export class VkService implements OnModuleInit {
  private readonly logger = new Logger(VkService.name);
  private readonly vkToken: string;
  private readonly apiVersion: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private apiService: ApiService,
  ) {
    this.vkToken = this.configService.get<string>('VK_TOKEN');
    this.apiVersion = this.configService.get<string>('VK_API_VERSION', '5.131');
  }

  async onModuleInit() {
    this.logger.log('VK Service initialized');
    await this.setupWebhook();
  }

  /**
   * Настройка вебхука в VK (можно вызвать отдельно через API)
   */
  private async setupWebhook(): Promise<void> {
    try {
      const webhookUrl = this.configService.get<string>('WEBHOOK_URL');
      
      if (!webhookUrl) {
        this.logger.warn('WEBHOOK_URL not set. VK Callback API may not work.');
        return;
      }

      this.logger.log(`VK Webhook URL: ${webhookUrl}/vk/callback`);
      this.logger.log('Please configure this URL in VK Group Settings > Callback API');
      this.logger.log(`Confirmation code: ${this.configService.get<string>('VK_CONFIRMATION')}`);
      
    } catch (error) {
      this.logger.error('Error setting up webhook:', error);
    }
  }

  /**
   * Получение информации о пользователе VK
   */
  async getVkUserInfo(userId: number): Promise<VkUser> {
    try {
      const response = await firstValueFrom(
        this.httpService.post('https://api.vk.com/method/users.get', {
          user_ids: userId,
          fields: 'photo_100',
          v: this.apiVersion,
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          params: {
            access_token: this.vkToken,
          },
        }),
      );

      if (response.data.error) {
        throw new Error(`VK API Error: ${response.data.error.error_msg}`);
      }

      return response.data.response[0];
    } catch (error) {
      this.logger.error(`Error getting VK user info for ${userId}:`, error);
      // Возвращаем минимальную информацию
      return {
        id: userId,
        first_name: 'VK',
        last_name: 'User',
      };
    }
  }

  /**
   * Отправка сообщения пользователю VK
   */
  async sendToVk(vkUserId: number, message: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.httpService.post('https://api.vk.com/method/messages.send', {
          user_id: vkUserId,
          message: message,
          random_id: Math.floor(Math.random() * 1000000),
          v: this.apiVersion,
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          params: {
            access_token: this.vkToken,
          },
        }),
      );

      if (response.data.error) {
        throw new Error(`VK API Error: ${response.data.error.error_msg}`);
      }

      this.logger.log(`Message sent to VK user ${vkUserId}: ${message.substring(0, 50)}...`);
      return response.data.response;

    } catch (error) {
      this.logger.error(`Error sending message to VK user ${vkUserId}:`, error);
      throw error;
    }
  }

  /**
   * Получение информации о группе
   */
  async getGroupInfo(): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.post('https://api.vk.com/method/groups.getById', {
          group_id: this.configService.get<string>('VK_GROUP_ID'),
          v: this.apiVersion,
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          params: {
            access_token: this.vkToken,
          },
        }),
      );

      return response.data.response;
    } catch (error) {
      this.logger.error('Error getting group info:', error);
      throw error;
    }
  }
}
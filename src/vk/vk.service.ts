import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class VkService {
  private readonly logger = new Logger(VkService.name);
  private readonly vkToken: string;
  private readonly apiVersion: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.vkToken = this.configService.get<string>('VK_TOKEN');
    this.apiVersion = this.configService.get<string>('VK_API_VERSION', '5.199');
  }

  /**
   * Получает информацию о пользователе VK
   */
  async getVkUserInfo(userId: number): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.post('https://api.vk.com/method/users.get', null, {
          params: {
            user_ids: userId,
            fields: 'first_name,last_name,photo_100',
            v: this.apiVersion,
            access_token: this.vkToken,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      if (response.data.error) {
        this.logger.error(`VK API Error: ${response.data.error.error_msg}`);
        return {
          id: userId,
          first_name: 'VK',
          last_name: 'User',
        };
      }

      return response.data.response[0];
    } catch (error) {
      this.logger.error(`Error getting VK user info for ${userId}:`, error.message);
      return {
        id: userId,
        first_name: 'VK',
        last_name: 'User',
      };
    }
  }
}
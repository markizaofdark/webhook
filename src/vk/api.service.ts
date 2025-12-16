import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly inboxId: string;
  private contactMap = new Map<number, number>();

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.apiUrl = this.configService.get<string>('API_URL');
    this.apiToken = this.configService.get<string>('API_TOKEN');
    this.inboxId = this.configService.get<string>('INBOX_ID');
  }

  private getHeaders() {
    return {
      'api_access_token': this.apiToken,
      'Content-Type': 'application/json',
    };
  }

  async getOrCreateContact(vkUserId: number, userInfo: any): Promise<number> {
    if (this.contactMap.has(vkUserId)) {
      return this.contactMap.get(vkUserId);
    }

    try {
      // Поиск существующего контакта
      const searchUrl = `${this.apiUrl}/api/v1/accounts/1/contacts/search`;
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { q: `vk_${vkUserId}` },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data.payload?.length > 0) {
        const contactId = searchResponse.data.payload[0].id;
        this.contactMap.set(vkUserId, contactId);
        return contactId;
      }

      // Создание нового контакта
      const createUrl = `${this.apiUrl}/api/v1/accounts/1/contacts`;
      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          {
            inbox_id: this.inboxId,
            name: `${userInfo.first_name} ${userInfo.last_name}`,
            identifier: `vk_${vkUserId}`,
            custom_attributes: {
              vk_id: vkUserId,
              vk_profile: `https://vk.com/id${vkUserId}`,
            },
          },
          { headers: this.getHeaders() },
        ),
      );

      const contactId = createResponse.data.id;
      this.contactMap.set(vkUserId, contactId);
      return contactId;
    } catch (error) {
      this.logger.error('Error getting/creating contact:', error.response?.data || error);
      throw error;
    }
  }

  async getOrCreateConversation(vkUserId: number, contactId: number): Promise<number> {
    try {
      // Попытка создать новую беседу
      const createUrl = `${this.apiUrl}/api/v1/accounts/1/conversations`;
      const response = await firstValueFrom(
        this.httpService.post(
          createUrl,
          {
            source_id: `vk_${vkUserId}`,
            inbox_id: this.inboxId,
            contact_id: contactId,
          },
          { headers: this.getHeaders() },
        ),
      ).catch(async () => {
        // Если беседа уже существует, ищем её
        const listUrl = `${this.apiUrl}/api/v1/accounts/1/conversations`;
        const listResponse = await firstValueFrom(
          this.httpService.get(listUrl, {
            params: { inbox_id: this.inboxId },
            headers: this.getHeaders(),
          }),
        );

        return listResponse;
      });

      const conversationId = response.data.id || 
        response.data.data?.payload?.find(
          (c: any) => c.meta?.sender?.identifier === `vk_${vkUserId}`
        )?.id;

      return conversationId;
    } catch (error) {
      this.logger.error('Error getting/creating conversation:', error.response?.data || error);
      throw error;
    }
  }

  async sendMessage(conversationId: number, content: string, messageType: string = 'incoming'): Promise<void> {
    try {
      const url = `${this.apiUrl}/api/v1/accounts/1/conversations/${conversationId}/messages`;
      await firstValueFrom(
        this.httpService.post(
          url,
          {
            content,
            message_type: messageType,
            private: false,
          },
          { headers: this.getHeaders() },
        ),
      );

      this.logger.log(`Message sent to conversation ${conversationId}`);
    } catch (error) {
      this.logger.error('Error sending message:', error.response?.data || error);
      throw error;
    }
  }
}

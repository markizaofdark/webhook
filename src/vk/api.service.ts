import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ApiService implements OnModuleInit {
  private readonly logger = new Logger(ApiService.name);
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;
  private readonly inboxId: string;
  private readonly accessToken: string;
  private readonly accountId: string = '1'; // Из URL видно, что account_id=1
  private contactMap = new Map<number, number>();

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Используем базовый URL API (без /app/accounts/...)
    this.apiBaseUrl = this.configService.get<string>('API_BASE_URL', 'https://guiai-test.ru');
    this.apiToken = this.configService.get<string>('API_TOKEN');
    this.inboxId = this.configService.get<string>('INBOX_ID');
    this.accessToken = this.configService.get<string>('ACCESS_TOKEN');
    
    // Валидация обязательных переменных
    this.validateConfig();
  }

  onModuleInit() {
    this.logger.log(`API Service initialized. Base URL: ${this.apiBaseUrl}`);
    this.logger.log(`Inbox ID: ${this.inboxId}, Account ID: ${this.accountId}`);
  }

  private validateConfig() {
    const required = ['API_TOKEN', 'INBOX_ID', 'ACCESS_TOKEN'];
    const missing = required.filter(key => !this.configService.get(key));
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  private getHeaders() {
    return {
      'api_access_token': this.apiToken,
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private getApiUrl(endpoint: string): string {
    return `${this.apiBaseUrl}/api/v1/accounts/${this.accountId}${endpoint}`;
  }

  async getOrCreateContact(vkUserId: number, userInfo: any): Promise<number> {
    const cacheKey = vkUserId;
    
    if (this.contactMap.has(cacheKey)) {
      return this.contactMap.get(cacheKey);
    }

    try {
      // Поиск существующего контакта по identifier
      const searchUrl = this.getApiUrl(`/contacts/search`);
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { q: `vk_${vkUserId}` },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data?.payload?.length > 0) {
        const contactId = searchResponse.data.payload[0].id;
        this.contactMap.set(cacheKey, contactId);
        this.logger.log(`Found existing contact ${contactId} for VK user ${vkUserId}`);
        return contactId;
      }

      // Создание нового контакта
      const createUrl = this.getApiUrl('/contacts');
      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          {
            inbox_id: parseInt(this.inboxId),
            name: `${userInfo.first_name} ${userInfo.last_name}`.trim(),
            email: `vk_${vkUserId}@vk.com`, // Добавляем email для Chatwoot
            phone_number: null,
            identifier: `vk_${vkUserId}`,
            custom_attributes: {
              vk_id: vkUserId.toString(),
              vk_profile: `https://vk.com/id${vkUserId}`,
            },
          },
          { headers: this.getHeaders() },
        ),
      );

      const contactId = createResponse.data.id;
      this.contactMap.set(cacheKey, contactId);
      this.logger.log(`Created new contact ${contactId} for VK user ${vkUserId}`);
      return contactId;
    } catch (error) {
      this.logger.error('Error getting/creating contact:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      
      // Fallback: вернуть временный ID для продолжения работы
      const fallbackId = Date.now();
      this.contactMap.set(cacheKey, fallbackId);
      return fallbackId;
    }
  }

  async getOrCreateConversation(vkUserId: number, contactId: number): Promise<number> {
    try {
      // Сначала поиск существующей беседы
      const searchUrl = this.getApiUrl('/conversations');
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { 
            inbox_id: this.inboxId,
            contact_id: contactId,
          },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data?.payload?.length > 0) {
        const conversation = searchResponse.data.payload.find(
          (conv: any) => conv.contact_id === contactId
        );
        if (conversation) {
          this.logger.log(`Found existing conversation ${conversation.id} for contact ${contactId}`);
          return conversation.id;
        }
      }

      // Создание новой беседы
      const createUrl = this.getApiUrl('/conversations');
      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          {
            source_id: `vk_${vkUserId}`,
            inbox_id: parseInt(this.inboxId),
            contact_id: contactId,
            additional_attributes: {
              vk_user_id: vkUserId,
            },
          },
          { headers: this.getHeaders() },
        ),
      );

      const conversationId = createResponse.data.id;
      this.logger.log(`Created new conversation ${conversationId} for contact ${contactId}`);
      return conversationId;
    } catch (error) {
      this.logger.error('Error getting/creating conversation:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      
      // Fallback: вернуть временный ID
      return Date.now();
    }
  }

  async sendMessage(conversationId: number, content: string, messageType: string = 'incoming'): Promise<void> {
    try {
      if (!content || content.trim().length === 0) {
        this.logger.warn('Empty message content, skipping');
        return;
      }

      const url = this.getApiUrl(`/conversations/${conversationId}/messages`);
      
      await firstValueFrom(
        this.httpService.post(
          url,
          {
            content: content.trim(),
            message_type: messageType,
            private: false,
          },
          { headers: this.getHeaders() },
        ),
      );

      this.logger.log(`Message sent to conversation ${conversationId}`);
    } catch (error) {
      this.logger.error('Error sending message:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        conversationId,
      });
    }
  }
}
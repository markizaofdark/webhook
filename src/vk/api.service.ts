import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ApiService implements OnModuleInit {
  private readonly logger = new Logger(ApiService.name);
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;
  private readonly inboxId: number;
  private readonly accountId: number = 1; // По умолчанию аккаунт 1
  private contactMap = new Map<number, number>();

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Базовый URL без /app
    this.apiBaseUrl = this.configService.get<string>('API_BASE_URL', 'https://guiai-test.ru');
    this.apiToken = this.configService.get<string>('ACCESS_TOKEN'); // Используем ACCESS_TOKEN!
    this.inboxId = parseInt(this.configService.get<string>('INBOX_ID', '4'));
    
    this.logger.log(`API Service initialized`);
    this.logger.log(`Base URL: ${this.apiBaseUrl}`);
    this.logger.log(`Inbox ID: ${this.inboxId}`);
    this.logger.log(`Account ID: ${this.accountId}`);
    
    // Проверяем конфигурацию
    this.validateConfig();
  }

  onModuleInit() {
    this.logger.log('API Service started');
  }

  private validateConfig() {
    if (!this.apiToken) {
      this.logger.error('ACCESS_TOKEN is not configured!');
    }
    if (!this.inboxId) {
      this.logger.error('INBOX_ID is not configured!');
    }
  }

  private getHeaders() {
    // Chatwoot API использует Bearer token авторизацию
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private getApiUrl(endpoint: string): string {
    return `${this.apiBaseUrl}/api/v1/accounts/${this.accountId}${endpoint}`;
  }

  async getOrCreateContact(vkUserId: number, userInfo: any): Promise<number | null> {
    const cacheKey = vkUserId;
    
    // Проверяем кэш
    if (this.contactMap.has(cacheKey)) {
      return this.contactMap.get(cacheKey);
    }

    try {
      // 1. Ищем контакт по identifier (vk_<user_id>)
      const searchUrl = this.getApiUrl('/contacts/search');
      const identifier = `vk_${vkUserId}`;
      
      this.logger.debug(`Searching contact with identifier: ${identifier}`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { 
            q: identifier
          },
          headers: this.getHeaders(),
        }),
      );

      // Chatwoot возвращает данные в формате { payload: [...] }
      if (searchResponse.data && searchResponse.data.payload && searchResponse.data.payload.length > 0) {
        const contact = searchResponse.data.payload[0];
        const contactId = contact.id;
        this.contactMap.set(cacheKey, contactId);
        this.logger.log(`Found existing contact: ${contactId} for VK user ${vkUserId}`);
        return contactId;
      }

      // 2. Создаем новый контакт
      this.logger.log(`Creating new contact for VK user ${vkUserId}`);
      
      const createUrl = this.getApiUrl('/contacts');
      
      const contactData = {
        inbox_id: this.inboxId,
        name: `${userInfo.first_name} ${userInfo.last_name}`.trim(),
        email: `vk_${vkUserId}@vk.com`, // Обязательное поле для Chatwoot
        phone_number: null,
        identifier: identifier,
        custom_attributes: {
          vk_id: vkUserId.toString(),
          vk_profile: `https://vk.com/id${vkUserId}`,
          source: 'vk_messenger',
          created_at: new Date().toISOString()
        }
      };

      this.logger.debug(`Contact data:`, contactData);

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          contactData,
          { 
            headers: this.getHeaders(),
          }
        ),
      );

      // Chatwoot возвращает созданный контакт в поле contact
      const contactId = createResponse.data?.contact?.id || createResponse.data?.id;
      
      if (!contactId) {
        throw new Error('No contact ID in response');
      }

      this.contactMap.set(cacheKey, contactId);
      this.logger.log(`Created new contact: ${contactId} for VK user ${vkUserId}`);
      return contactId;

    } catch (error) {
      this.logger.error(`Error in getOrCreateContact for user ${vkUserId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url
      });
      
      return null;
    }
  }

  async getOrCreateConversation(vkUserId: number, contactId: number): Promise<number | null> {
    try {
      if (!contactId) {
        this.logger.warn(`No contact ID provided for VK user ${vkUserId}`);
        return null;
      }

      // 1. Ищем существующую открытую беседу
      const searchUrl = this.getApiUrl('/conversations');
      
      this.logger.debug(`Searching conversation for contact ${contactId} in inbox ${this.inboxId}`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { 
            inbox_id: this.inboxId,
            contact_id: contactId,
            status: 'open'
          },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data && searchResponse.data.payload && searchResponse.data.payload.length > 0) {
        // Находим первую открытую беседу
        const openConversation = searchResponse.data.payload.find(
          (conv: any) => conv.status === 'open'
        );
        
        if (openConversation) {
          this.logger.log(`Found existing open conversation: ${openConversation.id} for contact ${contactId}`);
          return openConversation.id;
        }
      }

      // 2. Создаем новую беседу
      this.logger.log(`Creating new conversation for contact ${contactId}`);
      
      const createUrl = this.getApiUrl('/conversations');
      
      const conversationData = {
        source_id: `vk_${vkUserId}_${Date.now()}`,
        inbox_id: this.inboxId,
        contact_id: contactId,
        status: 'open',
        additional_attributes: {
          vk_user_id: vkUserId,
          vk_timestamp: new Date().toISOString(),
          platform: 'vk'
        }
      };

      this.logger.debug(`Conversation data:`, conversationData);

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          conversationData,
          { 
            headers: this.getHeaders(),
          }
        ),
      );

      const conversationId = createResponse.data?.id;
      
      if (!conversationId) {
        throw new Error('No conversation ID in response');
      }

      this.logger.log(`Created new conversation: ${conversationId} for contact ${contactId}`);
      return conversationId;

    } catch (error) {
      this.logger.error(`Error in getOrCreateConversation for contact ${contactId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url
      });
      
      return null;
    }
  }

  async sendMessage(conversationId: number, content: string): Promise<boolean> {
    try {
      if (!conversationId || !content || content.trim().length === 0) {
        this.logger.warn('Invalid parameters for sendMessage');
        return false;
      }

      const url = this.getApiUrl(`/conversations/${conversationId}/messages`);
      
      this.logger.debug(`Sending message to conversation ${conversationId}`);
      
      const messageData = {
        content: content.trim(),
        message_type: 'incoming',
        private: false
      };

      const response = await firstValueFrom(
        this.httpService.post(
          url,
          messageData,
          { 
            headers: this.getHeaders(),
          }
        ),
      );

      if (response.data && response.data.id) {
        this.logger.log(`Successfully sent message to conversation ${conversationId}`);
        return true;
      } else {
        this.logger.warn(`Unexpected response format from Chatwoot`);
        return false;
      }

    } catch (error) {
      this.logger.error(`Error sending message to conversation ${conversationId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url
      });
      
      return false;
    }
  }

  // Метод для тестирования подключения к Chatwoot
  async testConnection(): Promise<boolean> {
    try {
      const testUrl = this.getApiUrl('/contacts');
      const response = await firstValueFrom(
        this.httpService.get(testUrl, {
          headers: this.getHeaders(),
        }),
      );
      
      this.logger.log('Chatwoot API connection test: SUCCESS');
      return true;
    } catch (error) {
      this.logger.error('Chatwoot API connection test: FAILED', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      return false;
    }
  }
}
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
  private contactMap = new Map<number, number>();

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Важно: правильный базовый URL для Chatwoot API
    this.apiBaseUrl = this.configService.get<string>('API_BASE_URL', 'https://guiai-test.ru');
    this.apiToken = this.configService.get<string>('API_TOKEN');
    this.inboxId = this.configService.get<string>('INBOX_ID');
    
    this.logger.log(`API Service initialized. Base URL: ${this.apiBaseUrl}`);
    this.logger.log(`Using inbox: ${this.inboxId}`);
  }

  onModuleInit() {
    this.logger.log('API Service started. Testing connection...');
  }

  private getHeaders() {
  return {
    'Authorization': `Bearer ${this.configService.get('ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

  private getApiUrl(endpoint: string): string {
    // Формируем URL в формате Chatwoot API
    return `${this.apiBaseUrl}/api/v1/accounts/1${endpoint}`;
  }

  async getOrCreateContact(vkUserId: number, userInfo: any): Promise<number | null> {
    const cacheKey = vkUserId;
    
    if (this.contactMap.has(cacheKey)) {
      return this.contactMap.get(cacheKey);
    }

    try {
      // 1. Попробуем найти существующий контакт
      const searchUrl = this.getApiUrl('/contacts/search');
      this.logger.debug(`Searching contact for VK user ${vkUserId}...`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { 
            q: `vk_${vkUserId}`,
            sort: 'created_at'
          },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data?.payload && searchResponse.data.payload.length > 0) {
        const contact = searchResponse.data.payload[0];
        const contactId = contact.id;
        this.contactMap.set(cacheKey, contactId);
        this.logger.log(`Found existing contact ${contactId} for VK user ${vkUserId}`);
        return contactId;
      }

      // 2. Создаем новый контакт
      this.logger.log(`Creating new contact for VK user ${vkUserId}...`);
      const createUrl = this.getApiUrl('/contacts');
      
      const contactData = {
        inbox_id: parseInt(this.inboxId),
        name: `${userInfo.first_name} ${userInfo.last_name}`.trim(),
        email: `vk_${vkUserId}@vk.com`, // Требуется email для Chatwoot
        phone_number: null,
        identifier: `vk_${vkUserId}`,
        custom_attributes: {
          vk_id: vkUserId.toString(),
          vk_profile: `https://vk.com/id${vkUserId}`,
          source: 'vk_messenger'
        }
      };

      this.logger.debug(`Contact data: ${JSON.stringify(contactData)}`);

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          contactData,
          { 
            headers: this.getHeaders(),
            timeout: 10000 // 10 секунд таймаут
          }
        ),
      );

      if (!createResponse.data || !createResponse.data.id) {
        throw new Error('Invalid response from Chatwoot API');
      }

      const contactId = createResponse.data.id;
      this.contactMap.set(cacheKey, contactId);
      this.logger.log(`Created new contact ${contactId} for VK user ${vkUserId}`);
      return contactId;

    } catch (error) {
      this.logger.error(`Error in getOrCreateContact for user ${vkUserId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
      // Возвращаем null вместо fallback ID
      return null;
    }
  }

  async getOrCreateConversation(vkUserId: number, contactId: number): Promise<number | null> {
    try {
      if (!contactId) {
        this.logger.warn(`No contact ID provided for VK user ${vkUserId}`);
        return null;
      }

      // 1. Попробуем найти существующую беседу
      const searchUrl = this.getApiUrl('/conversations');
      this.logger.debug(`Searching conversation for contact ${contactId}...`);
      
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

      if (searchResponse.data?.payload && searchResponse.data.payload.length > 0) {
        const conversation = searchResponse.data.payload[0];
        this.logger.log(`Found existing conversation ${conversation.id} for contact ${contactId}`);
        return conversation.id;
      }

      // 2. Создаем новую беседу
      this.logger.log(`Creating new conversation for contact ${contactId}...`);
      const createUrl = this.getApiUrl('/conversations');
      
      const conversationData = {
        source_id: `vk_${vkUserId}_${Date.now()}`, // Уникальный source_id
        inbox_id: parseInt(this.inboxId),
        contact_id: contactId,
        status: 'open',
        additional_attributes: {
          vk_user_id: vkUserId,
          timestamp: new Date().toISOString()
        }
      };

      this.logger.debug(`Conversation data: ${JSON.stringify(conversationData)}`);

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          conversationData,
          { 
            headers: this.getHeaders(),
            timeout: 10000
          }
        ),
      );

      if (!createResponse.data || !createResponse.data.id) {
        throw new Error('Invalid response from Chatwoot API');
      }

      const conversationId = createResponse.data.id;
      this.logger.log(`Created new conversation ${conversationId} for contact ${contactId}`);
      return conversationId;

    } catch (error) {
      this.logger.error(`Error in getOrCreateConversation for contact ${contactId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
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
      this.logger.debug(`Sending message to conversation ${conversationId}...`);
      
      await firstValueFrom(
        this.httpService.post(
          url,
          {
            content: content.trim(),
            message_type: 'incoming',
            private: false,
          },
          { 
            headers: this.getHeaders(),
            timeout: 10000
          }
        ),
      );

      this.logger.log(`Successfully sent message to conversation ${conversationId}`);
      return true;

    } catch (error) {
      this.logger.error(`Error sending message to conversation ${conversationId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      return false;
    }
  }
}
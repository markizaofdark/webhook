import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface ChatwootContact {
  id: number;
  name: string;
  email: string;
  identifier: string;
  custom_attributes: Record<string, any>;
}

interface ChatwootConversation {
  id: number;
  inbox_id: number;
  contact_id: number;
  status: string;
}

@Injectable()
export class ApiService implements OnModuleInit {
  private readonly logger = new Logger(ApiService.name);
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;
  private readonly inboxId: string;
  private readonly accountId: string = '1';
  private contactMap = new Map<number, number>();

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Используем базовый URL без /app
    this.apiBaseUrl = 'https://guiai-test.ru';
    this.apiToken = this.configService.get<string>('API_TOKEN');
    this.inboxId = this.configService.get<string>('INBOX_ID', '4');
    
    this.logger.log('Chatwoot Admin API Service initialized');
    this.logger.log(`Base URL: ${this.apiBaseUrl}`);
    this.logger.log(`Account ID: ${this.accountId}`);
    this.logger.log(`Inbox ID: ${this.inboxId}`);
  }

  onModuleInit() {
    this.testConnection();
  }

  private getHeaders() {
    // Chatwoot Admin API использует api_access_token
    return {
      'api_access_token': this.apiToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private buildApiUrl(endpoint: string): string {
    // Стандартные endpoint'ы Chatwoot API
    return `${this.apiBaseUrl}/api/v1/accounts/${this.accountId}${endpoint}`;
  }

  async testConnection(): Promise<void> {
    try {
      const testUrl = this.buildApiUrl('/inboxes');
      this.logger.log(`Testing connection to Chatwoot API: ${testUrl}`);
      
      const response = await firstValueFrom(
        this.httpService.get(testUrl, {
          headers: this.getHeaders(),
          timeout: 5000,
        }),
      );

      if (response.status === 200) {
        this.logger.log('Chatwoot API connection: SUCCESS');
        this.logger.log(`Available inboxes: ${response.data?.payload?.length || 0}`);
      }
    } catch (error) {
      this.logger.error('Chatwoot API connection: FAILED', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url,
      });
    }
  }

  async getOrCreateContact(vkUserId: number, userInfo: any): Promise<number | null> {
    const cacheKey = vkUserId;
    
    // Проверяем кэш
    if (this.contactMap.has(cacheKey)) {
      return this.contactMap.get(cacheKey);
    }

    try {
      const identifier = `vk_${vkUserId}`;
      
      // 1. Ищем контакт по identifier
      const searchUrl = this.buildApiUrl('/contacts/search');
      this.logger.debug(`Searching contact: ${identifier}`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: { q: identifier },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data?.payload?.length > 0) {
        const contact = searchResponse.data.payload[0] as ChatwootContact;
        this.contactMap.set(cacheKey, contact.id);
        this.logger.log(`Found contact: ${contact.id} for VK user ${vkUserId}`);
        return contact.id;
      }

      // 2. Создаем новый контакт
      this.logger.log(`Creating contact for VK user ${vkUserId}`);
      
      const createUrl = this.buildApiUrl('/contacts');
      const contactData = {
        inbox_id: parseInt(this.inboxId),
        name: `${userInfo.first_name} ${userInfo.last_name}`.trim(),
        email: `vk_${vkUserId}@vk.com`,
        phone_number: null,
        identifier: identifier,
        custom_attributes: {
          vk_id: vkUserId.toString(),
          vk_profile: `https://vk.com/id${vkUserId}`,
          source: 'vk_messenger',
          created_at: new Date().toISOString(),
        },
      };

      this.logger.debug('Contact data:', contactData);

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          contactData,
          { headers: this.getHeaders() }
        ),
      );

      const contactId = createResponse.data?.id;
      
      if (!contactId) {
        throw new Error('No contact ID in response');
      }

      this.contactMap.set(cacheKey, contactId);
      this.logger.log(`Created contact: ${contactId} for VK user ${vkUserId}`);
      return contactId;

    } catch (error) {
      this.logger.error(`Failed to get/create contact for ${vkUserId}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url,
      });
      
      // Fallback ID для продолжения работы
      const fallbackId = Date.now();
      this.contactMap.set(cacheKey, fallbackId);
      return fallbackId;
    }
  }

  async getOrCreateConversation(vkUserId: number, contactId: number): Promise<number | null> {
    try {
      // 1. Ищем существующую беседу
      const searchUrl = this.buildApiUrl('/conversations');
      this.logger.debug(`Searching conversation for contact ${contactId}`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(searchUrl, {
          params: {
            inbox_id: this.inboxId,
            contact_id: contactId,
            status: 'open',
          },
          headers: this.getHeaders(),
        }),
      );

      if (searchResponse.data?.payload?.length > 0) {
        const conversation = searchResponse.data.payload[0] as ChatwootConversation;
        this.logger.log(`Found conversation: ${conversation.id} for contact ${contactId}`);
        return conversation.id;
      }

      // 2. Создаем новую беседу
      this.logger.log(`Creating conversation for contact ${contactId}`);
      
      const createUrl = this.buildApiUrl('/conversations');
      const conversationData = {
        source_id: `vk_${vkUserId}_${Date.now()}`,
        inbox_id: parseInt(this.inboxId),
        contact_id: contactId,
        status: 'open',
        additional_attributes: {
          vk_user_id: vkUserId,
          source: 'vk_messenger',
        },
      };

      this.logger.debug('Conversation data:', conversationData);

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          conversationData,
          { headers: this.getHeaders() }
        ),
      );

      const conversationId = createResponse.data?.id;
      
      if (!conversationId) {
        throw new Error('No conversation ID in response');
      }

      this.logger.log(`Created conversation: ${conversationId} for contact ${contactId}`);
      return conversationId;

    } catch (error) {
      this.logger.error(`Failed to get/create conversation:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url,
      });
      
      // Fallback ID
      return Date.now();
    }
  }

  async sendMessage(conversationId: number, content: string): Promise<boolean> {
    try {
      if (!content || content.trim().length === 0) {
        this.logger.warn('Empty message, skipping');
        return false;
      }

      const url = this.buildApiUrl(`/conversations/${conversationId}/messages`);
      this.logger.debug(`Sending message to conversation ${conversationId}`);
      
      const messageData = {
        content: content.trim(),
        message_type: 'incoming',
        private: false,
      };

      await firstValueFrom(
        this.httpService.post(
          url,
          messageData,
          { headers: this.getHeaders() }
        ),
      );

      this.logger.log(`Message sent to conversation ${conversationId}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to send message:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url,
      });
      return false;
    }
  }
}
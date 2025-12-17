import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly inboxId: string;
  private contactMap = new Map<number, number>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiBaseUrl = this.configService.get<string>('API_BASE_URL');
    this.apiToken = this.configService.get<string>('API_TOKEN');
    this.accountId = this.configService.get<string>('ACCOUNT_ID', '1');
    this.inboxId = this.configService.get<string>('INBOX_ID', '4');
    
    this.logger.log(`Chatwoot Application API initialized for account ${this.accountId}, inbox ${this.inboxId}`);
    this.validateConfig();
  }

  private validateConfig() {
    if (!this.apiToken) {
      this.logger.warn('API_TOKEN is not configured!');
    }
  }

  /**
   * Формирует URL для Chatwoot API с добавлением токена в query-параметр
   * Это обходит проблему Nginx с заголовками с подчёркиванием
   */
  private buildApiUrl(endpoint: string): string {
    const baseUrl = `${this.apiBaseUrl}/api/v1/accounts/${this.accountId}${endpoint}`;
    // Добавляем токен как query-параметр для обхода проблем с заголовками
    return `${baseUrl}?api_access_token=${encodeURIComponent(this.apiToken)}`;
  }

  /**
   * Получает или создаёт контакт в Chatwoot
   */
  async getOrCreateContact(vkUserId: number, userInfo: any): Promise<number | null> {
    const cacheKey = vkUserId;
    
    // Проверяем кэш
    if (this.contactMap.has(cacheKey)) {
      return this.contactMap.get(cacheKey);
    }

    try {
      const identifier = `vk_${vkUserId}`;
      
      // 1. Ищем существующий контакт
      const searchUrl = this.buildApiUrl('/contacts/search');
      const searchParams = new URLSearchParams({
        q: identifier
      }).toString();
      
      const fullSearchUrl = `${searchUrl}&${searchParams}`;
      
      this.logger.debug(`Searching contact: ${identifier}`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(fullSearchUrl, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        })
      );

      if (searchResponse.data?.payload?.length > 0) {
        const contactId = searchResponse.data.payload[0].id;
        this.contactMap.set(cacheKey, contactId);
        this.logger.log(`Found contact: ${contactId} for VK user ${vkUserId}`);
        return contactId;
      }

      // 2. Создаём новый контакт
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
          created_at: new Date().toISOString()
        }
      };

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          contactData,
          { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          }
        )
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
        message: error.message
      });
      
      // Fallback: генерируем временный ID для продолжения работы
      const fallbackId = Math.floor(Math.random() * 1000000);
      this.contactMap.set(cacheKey, fallbackId);
      return fallbackId;
    }
  }

  /**
   * Получает или создаёт беседу в Chatwoot
   */
  async getOrCreateConversation(vkUserId: number, contactId: number): Promise<number | null> {
    try {
      // 1. Ищем существующую беседу
      const searchUrl = this.buildApiUrl('/conversations');
      const searchParams = new URLSearchParams({
        inbox_id: this.inboxId,
        contact_id: contactId.toString(),
        status: 'open'
      }).toString();
      
      const fullSearchUrl = `${searchUrl}&${searchParams}`;
      
      this.logger.debug(`Searching conversation for contact ${contactId}`);
      
      const searchResponse = await firstValueFrom(
        this.httpService.get(fullSearchUrl, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        })
      );

      if (searchResponse.data?.payload?.length > 0) {
        const conversation = searchResponse.data.payload.find(
          (conv: any) => conv.contact_id === contactId && conv.status === 'open'
        );
        
        if (conversation) {
          this.logger.log(`Found conversation: ${conversation.id} for contact ${contactId}`);
          return conversation.id;
        }
      }

      // 2. Создаём новую беседу
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
          timestamp: new Date().toISOString()
        }
      };

      const createResponse = await firstValueFrom(
        this.httpService.post(
          createUrl,
          conversationData,
          { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          }
        )
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
        message: error.message
      });
      
      return null;
    }
  }

  /**
   * Отправляет сообщение в беседу Chatwoot
   */
  async sendMessage(conversationId: number, content: string): Promise<boolean> {
    try {
      if (!content || content.trim().length === 0) {
        this.logger.warn('Empty message, skipping');
        return false;
      }

      const url = this.buildApiUrl(`/conversations/${conversationId}/messages`);
      
      const messageData = {
        content: content.trim(),
        message_type: 'incoming',
        private: false
      };

      this.logger.debug(`Sending message to conversation ${conversationId}`);
      
      await firstValueFrom(
        this.httpService.post(
          url,
          messageData,
          { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          }
        )
      );

      this.logger.log(`Message sent to conversation ${conversationId}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to send message:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      return false;
    }
  }

  /**
   * Тестирует подключение к Chatwoot API
   */
  async testConnection(): Promise<boolean> {
    try {
      const testUrl = this.buildApiUrl('/inboxes');
      
      this.logger.log(`Testing Chatwoot API connection: ${testUrl.split('?')[0]}`);
      
      const response = await firstValueFrom(
        this.httpService.get(testUrl, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        })
      );

      if (response.status === 200) {
        this.logger.log('Chatwoot API connection: SUCCESS');
        this.logger.log(`Available inboxes: ${response.data?.payload?.length || 0}`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error('Chatwoot API connection: FAILED', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      return false;
    }
  }

  /**
   * Комплексный метод: обрабатывает сообщение от VK
   */
  async processVkMessage(vkUserId: number, userInfo: any, messageText: string): Promise<boolean> {
    try {
      // 1. Получаем/создаём контакт
      const contactId = await this.getOrCreateContact(vkUserId, userInfo);
      
      if (!contactId) {
        this.logger.error(`Failed to get/create contact for ${vkUserId}`);
        return false;
      }
      
      // 2. Получаем/создаём беседу
      const conversationId = await this.getOrCreateConversation(vkUserId, contactId);
      
      if (!conversationId) {
        this.logger.error(`Failed to get/create conversation for contact ${contactId}`);
        return false;
      }
      
      // 3. Отправляем сообщение
      const success = await this.sendMessage(conversationId, messageText);
      
      return success;
    } catch (error) {
      this.logger.error(`Failed to process VK message:`, error.message);
      return false;
    }
  }
}
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { VkService } from './vk.service';
import { VkController } from './vk.controller';
import { ApiService } from './api.service';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [VkController],
  providers: [VkService, ApiService],
})
export class VkModule {}
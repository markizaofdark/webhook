import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VkModule } from './vk/vk.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    VkModule,
  ],
})
export class AppModule {}

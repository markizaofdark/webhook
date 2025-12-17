import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VkModule } from './vk/vk.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    VkModule,
  ],
})
export class AppModule {}
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  
  vk: {
    token: process.env.VK_TOKEN,
    confirmation: process.env.VK_CONFIRMATION,
    groupId: parseInt(process.env.VK_GROUP_ID, 10),
    apiVersion: process.env.VK_API_VERSION || '5.199',
    secret: process.env.VK_SECRET,
  },
  
  chatwoot: {
    apiBaseUrl: process.env.API_BASE_URL || 'https://guiai-test.ru',
    apiToken: process.env.API_TOKEN,
    accessToken: process.env.ACCESS_TOKEN,
    inboxId: parseInt(process.env.INBOX_ID, 10),
    accountId: 1, // Из URL
  },
  
  webhook: {
    url: process.env.WEBHOOK_URL,
  },
});
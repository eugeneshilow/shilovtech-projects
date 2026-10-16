// Установка бота: npx convex run --prod setup:register из main/.
// Ставит вебхук с секретом, команды, описание и короткое описание из convex/texts.ts.

import { internalAction } from './_generated/server'
import { callTelegram, expectedWebhookUrl } from './bot'
import { webhookProblem, type WebhookInfo } from './logic'
import { COMMANDS, texts } from './texts'

export const register = internalAction({
  args: {},
  handler: async () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET не задан в переменных окружения деплоя')
    const url = expectedWebhookUrl()

    await callTelegram('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    })
    await callTelegram('setMyCommands', { commands: COMMANDS })
    await callTelegram('setMyDescription', { description: texts.description })
    await callTelegram('setMyShortDescription', { short_description: texts.shortDescription })

    const me = await callTelegram<{ username: string; first_name: string }>('getMe')
    const webhook = await callTelegram<WebhookInfo>('getWebhookInfo')
    return {
      bot: `@${me.username}`,
      name: me.first_name,
      link: `https://t.me/${me.username}`,
      expectedUrl: url,
      problem: webhookProblem(webhook, url, Date.now()),
      webhook,
    }
  },
})

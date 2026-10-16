import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction, type ActionCtx } from './_generated/server'
import { isWebhookAuthorized, readMessage, type TelegramUpdate } from './logic'

/**
 * Вебхук Telegram. Пускает только запросы с верным секретом, остальным — 401.
 * Telegram сразу получает 200; ответ готовит bot:handleUpdate.
 */
export async function handleTelegramPost(
  ctx: Pick<ActionCtx, 'scheduler'>,
  request: Request,
): Promise<Response> {
  const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (!isWebhookAuthorized(header, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response('unauthorized', { status: 401 })
  }
  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    console.error('Вебхук: тело запроса — не JSON')
    return new Response('ok', { status: 200 })
  }
  const incoming = readMessage(update)
  if (incoming) await ctx.scheduler.runAfter(0, internal.bot.handleUpdate, { incoming })
  return new Response('ok', { status: 200 })
}

const http = httpRouter()

http.route({
  path: '/telegram',
  method: 'POST',
  handler: httpAction(handleTelegramPost),
})

export default http

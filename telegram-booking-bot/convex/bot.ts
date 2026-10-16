// Функции бота в Convex. Канон — docs/telegram/README.md.

import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import {
  bookingsText,
  cancelKeyboard,
  clientName,
  dayLabel,
  dayOf,
  daysKeyboard,
  freeDays,
  freeSlots,
  hoursKeyboard,
  isBookable,
  readAction,
  statusText,
  timeLabel,
  webhookProblem,
  weekdayLabel,
  windowEnd,
  type Keyboard,
  type Stats,
  type WebhookInfo,
} from './logic'
import { texts } from './texts'

const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_LIMIT = 500

export const incomingValidator = v.object({
  chatId: v.number(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  username: v.optional(v.string()),
  command: v.union(v.string(), v.null()),
  startLabel: v.optional(v.string()),
  callbackId: v.optional(v.string()),
  callbackData: v.optional(v.string()),
})

/** Адрес, на котором вебхук должен стоять: роут /telegram этого деплоя. */
export function expectedWebhookUrl(): string {
  return `${process.env.CONVEX_SITE_URL}/telegram`
}

/** Telegram ID мастера из переменной MASTER_ID; null — не задан. */
export function masterId(): number | null {
  const id = Number(process.env.MASTER_ID)
  return Number.isInteger(id) && id !== 0 ? id : null
}

/** Вызов Bot API. Ключ берётся из переменных окружения и не попадает ни в ошибки, ни в логи. */
export async function callTelegram<T>(method: string, body: object = {}): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан в переменных окружения деплоя')
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    // Исходную ошибку не прикладываем: в ней может быть адрес запроса с ключом.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Telegram ${method}: сеть — ${String(error).replaceAll(token, '<ключ>')}`)
  }
  const data = (await response.json()) as { ok: boolean; result?: T; description?: string }
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? response.status}`)
  return data.result as T
}

export const handleUpdate = internalAction({
  args: { incoming: incomingValidator },
  handler: async (ctx, { incoming }) => {
    await ctx.runMutation(internal.bot.recordMessage, { incoming })
    if (incoming.callbackId) {
      // Убирает «часики» на нажатой кнопке; если не вышло, ответ всё равно уйдёт.
      await callTelegram('answerCallbackQuery', { callback_query_id: incoming.callbackId }).catch(
        (error) => console.warn(String(error)),
      )
    }

    const master = masterId()
    const isMaster = incoming.chatId === master
    const now = Date.now()
    const failures: string[] = []
    const send = async (chatId: number | null, text: string, keyboard?: Keyboard) => {
      if (chatId === null) {
        console.warn(`MASTER_ID не задан, мастеру не ушло: ${text}`)
        return
      }
      try {
        await callTelegram('sendMessage', { chat_id: chatId, text, reply_markup: keyboard })
      } catch (error) {
        failures.push(String(error))
      }
    }
    const taken = () => ctx.runQuery(internal.bot.takenSlots, { from: now, to: windowEnd(now) })
    const reply = (text: string, keyboard?: Keyboard) => send(incoming.chatId, text, keyboard)
    const replyWithDays = async (text: string) => {
      const days = freeDays(now, await taken())
      return days.length > 0 ? reply(text, daysKeyboard(days)) : reply(texts.noDays)
    }

    const action = readAction(incoming)
    switch (action.type) {
      case 'start':
        await replyWithDays(texts.start)
        break
      case 'day': {
        const slots = freeSlots(action.day, now, await taken())
        if (slots.length > 0)
          await reply(texts.chooseHour(dayLabel(action.day)), hoursKeyboard(slots))
        else await replyWithDays(texts.dayFull)
        break
      }
      case 'slot': {
        const name = clientName(incoming)
        const result = await ctx.runMutation(internal.bot.book, {
          chatId: incoming.chatId,
          name,
          slot: action.slot,
        })
        if (result.status === 'booked') {
          await reply(
            texts.booked(weekdayLabel(action.slot), timeLabel(action.slot)),
            cancelKeyboard(action.slot),
          )
          await send(
            master,
            texts.masterBooked(name, weekdayLabel(action.slot), timeLabel(action.slot)),
          )
        } else if (result.status === 'already') {
          await reply(
            texts.alreadyBooked(weekdayLabel(result.slot), timeLabel(result.slot)),
            cancelKeyboard(result.slot),
          )
        } else if (result.status === 'taken') {
          const slots = freeSlots(dayOf(action.slot), now, await taken())
          if (slots.length > 0) await reply(texts.slotTaken, hoursKeyboard(slots))
          else await replyWithDays(texts.dayFull)
        } else {
          await replyWithDays(texts.slotPast)
        }
        break
      }
      case 'cancel': {
        const result = await ctx.runMutation(internal.bot.cancel, {
          chatId: incoming.chatId,
          slot: action.slot,
        })
        if (result.status === 'cancelled') {
          await reply(texts.cancelled(weekdayLabel(action.slot), timeLabel(action.slot)))
          await send(
            master,
            texts.masterCancelled(result.name, weekdayLabel(action.slot), timeLabel(action.slot)),
          )
        } else {
          await reply(texts.cancelMissing)
        }
        break
      }
      case 'bookings':
        if (!isMaster) {
          await reply(texts.masterOnly)
          break
        }
        await reply(
          bookingsText(
            await ctx.runQuery(internal.bot.weekBookings, { from: now, to: windowEnd(now) }),
          ),
        )
        break
      case 'status': {
        if (!isMaster) {
          await reply(texts.masterOnly)
          break
        }
        const stats = await ctx.runQuery(internal.bot.stats, { now })
        const info = await callTelegram<WebhookInfo>('getWebhookInfo')
        await reply(statusText(stats, webhookProblem(info, expectedWebhookUrl(), now)))
        break
      }
      case 'help':
        await reply(texts.help)
        break
      case 'fallback':
        await reply(texts.fallback)
        break
    }

    if (failures.length > 0) throw new Error(failures.join('; '))
  },
})

/** Записывает клиента на час. Проверка и запись — одна транзакция: двое на один час не попадут. */
export const book = internalMutation({
  args: { chatId: v.number(), name: v.string(), slot: v.number() },
  handler: async (ctx, { chatId, name, slot }) => {
    const now = Date.now()
    if (!isBookable(slot, now)) return { status: 'past' as const }

    const mine = await ctx.db
      .query('bookings')
      .withIndex('by_chat_status', (q) => q.eq('chatId', chatId).eq('status', 'active'))
      .collect()
    const upcoming = mine.find((booking) => booking.slot > now)
    if (upcoming) return { status: 'already' as const, slot: upcoming.slot }

    const busy = await ctx.db
      .query('bookings')
      .withIndex('by_status_slot', (q) => q.eq('status', 'active').eq('slot', slot))
      .first()
    if (busy) return { status: 'taken' as const }

    await ctx.db.insert('bookings', { chatId, name, slot, status: 'active', createdAt: now })
    return { status: 'booked' as const }
  },
})

/** Отменяет запись клиента на этот час, если она ещё впереди. */
export const cancel = internalMutation({
  args: { chatId: v.number(), slot: v.number() },
  handler: async (ctx, { chatId, slot }) => {
    const now = Date.now()
    const mine = await ctx.db
      .query('bookings')
      .withIndex('by_chat_status', (q) => q.eq('chatId', chatId).eq('status', 'active'))
      .collect()
    const booking = mine.find((b) => b.slot === slot && b.slot > now)
    if (!booking) return { status: 'missing' as const }
    await ctx.db.patch(booking._id, { status: 'cancelled', cancelledAt: now })
    return { status: 'cancelled' as const, name: booking.name }
  },
})

export const takenSlots = internalQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<number[]> => {
    const active = await ctx.db
      .query('bookings')
      .withIndex('by_status_slot', (q) => q.eq('status', 'active').gt('slot', from).lt('slot', to))
      .collect()
    return active.map((booking) => booking.slot)
  },
})

export const weekBookings = internalQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const active = await ctx.db
      .query('bookings')
      .withIndex('by_status_slot', (q) => q.eq('status', 'active').gt('slot', from).lt('slot', to))
      .collect()
    return active.map(({ slot, name }) => ({ slot, name }))
  },
})

export const recordMessage = internalMutation({
  args: { incoming: incomingValidator },
  handler: async (ctx, { incoming }) => {
    const now = Date.now()
    const chat = await ctx.db
      .query('chats')
      .withIndex('by_chatId', (q) => q.eq('chatId', incoming.chatId))
      .unique()
    if (chat) {
      await ctx.db.patch(chat._id, {
        firstName: incoming.firstName ?? chat.firstName,
        username: incoming.username ?? chat.username,
        startLabel: chat.startLabel ?? incoming.startLabel,
        lastMessageAt: now,
        messageCount: chat.messageCount + 1,
        recentMessageTimes: [
          ...chat.recentMessageTimes.filter((at) => at > now - DAY_MS),
          now,
        ].slice(-RECENT_LIMIT),
      })
    } else {
      await ctx.db.insert('chats', {
        chatId: incoming.chatId,
        firstName: incoming.firstName,
        username: incoming.username,
        startLabel: incoming.startLabel,
        firstMessageAt: now,
        lastMessageAt: now,
        messageCount: 1,
        recentMessageTimes: [now],
      })
    }
  },
})

export const stats = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<Stats> => {
    const chats = await ctx.db.query('chats').collect()
    let messagesDay = 0
    let lastMessageAt: number | null = null
    for (const chat of chats) {
      messagesDay += chat.recentMessageTimes.filter((at) => at > now - DAY_MS).length
      if (lastMessageAt === null || chat.lastMessageAt > lastMessageAt) {
        lastMessageAt = chat.lastMessageAt
      }
    }
    return { chats: chats.length, messagesDay, lastMessageAt }
  },
})

/** Селфхил: раз в час спрашивает Telegram, стоит ли вебхук; сломан — громко падает. */
export const checkWebhook = internalAction({
  args: {},
  handler: async () => {
    const info = await callTelegram<WebhookInfo>('getWebhookInfo')
    const problem = webhookProblem(info, expectedWebhookUrl(), Date.now())
    if (problem === null) {
      console.log('Вебхук стоит, ошибок нет')
      return
    }
    const master = masterId()
    if (master !== null) {
      try {
        await callTelegram('sendMessage', { chat_id: master, text: texts.broken(problem) })
      } catch (error) {
        console.error(`Не удалось написать мастеру: ${String(error)}`)
      }
    }
    throw new Error(`Бот сломан: ${problem}`)
  },
})

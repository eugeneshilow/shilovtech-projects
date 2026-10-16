// Чистая логика бота: без сети и без базы, чтобы её проверяли тесты.
// Канон — docs/telegram/README.md.

import { texts } from './texts'

/** Мастер работает пн–сб (0 — воскресенье), с 10:00 до 20:00 по Москве; запись — на 1 час, с начала часа. */
export const WORK_DAYS = [1, 2, 3, 4, 5, 6]
export const OPEN_HOUR = 10
export const CLOSE_HOUR = 20
/** Окно записи: сегодня и 6 следующих дней по Москве. */
export const WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
/** Москва живёт в UTC+3 круглый год, без перевода часов. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
/** Ошибка доставки «свежая», если случилась после прошлой проверки раз в час (с запасом). */
export const FRESH_ERROR_MS = 65 * 60 * 1000

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

// ── Обновления Telegram ────────────────────────────────────────────────

type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string }

export type TelegramUpdate = {
  update_id: number
  message?: { chat: { id: number }; from?: TelegramUser; text?: string }
  callback_query?: {
    id: string
    from: TelegramUser
    message?: { chat: { id: number } }
    data?: string
  }
}

export type WebhookInfo = {
  url: string
  pending_update_count: number
  last_error_date?: number
  last_error_message?: string
}

/** Короткая запись об обновлении: кто, какая команда, какая метка, какая кнопка. Текст дальше не идёт. */
export type Incoming = {
  chatId: number
  firstName?: string
  lastName?: string
  username?: string
  command: string | null
  startLabel?: string
  callbackId?: string
  callbackData?: string
}

const COMMAND = /^\/([\p{L}0-9_]+)(?:@\w+)?(?:\s+(\S+))?/iu
const START_LABEL = /^[A-Za-z0-9_-]{1,64}$/

export function readMessage(update: TelegramUpdate): Incoming | null {
  const callback = update.callback_query
  if (callback) {
    return {
      chatId: callback.message?.chat.id ?? callback.from.id,
      firstName: callback.from.first_name,
      lastName: callback.from.last_name,
      username: callback.from.username,
      command: null,
      callbackId: callback.id,
      callbackData: callback.data,
    }
  }
  const message = update.message
  if (!message) return null
  const match = COMMAND.exec((message.text ?? '').trim())
  const command = match ? match[1].toLowerCase() : null
  const payload = match?.[2]
  return {
    chatId: message.chat.id,
    firstName: message.from?.first_name,
    lastName: message.from?.last_name,
    username: message.from?.username,
    command,
    startLabel: command === 'start' && payload && START_LABEL.test(payload) ? payload : undefined,
  }
}

export type Action =
  | { type: 'start' | 'help' | 'status' | 'bookings' | 'fallback' }
  | { type: 'day'; day: string }
  | { type: 'slot' | 'cancel'; slot: number }

/** Что человек попросил: команду или кнопку. */
export function readAction(incoming: Incoming): Action {
  const data = incoming.callbackData
  if (data !== undefined) {
    const [kind, value] = data.split(':')
    if (kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'day', day: value }
    if ((kind === 'slot' || kind === 'cancel') && /^\d+$/.test(value)) {
      return { type: kind, slot: Number(value) }
    }
    return { type: 'fallback' }
  }
  switch (incoming.command) {
    case 'start':
      return { type: 'start' }
    case 'help':
      return { type: 'help' }
    case 'status':
      return { type: 'status' }
    case 'записи':
      return { type: 'bookings' }
    default:
      return { type: 'fallback' }
  }
}

export function clientName(incoming: Incoming): string {
  const name = [incoming.firstName, incoming.lastName].filter(Boolean).join(' ')
  return name || incoming.username || texts.defaultName
}

// ── Время по Москве и свободные часы ───────────────────────────────────

function msk(ms: number) {
  const d = new Date(ms + MSK_OFFSET_MS)
  return {
    day: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    time: d.toISOString().slice(11, 16),
  }
}

/** Начало часа `hour` по Москве в день `day` (ГГГГ-ММ-ДД), в мс. */
export function slotAt(day: string, hour: number): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hour) - MSK_OFFSET_MS
}

/** 7 дней окна по Москве, начиная с сегодняшнего. */
export function windowDays(now: number): string[] {
  const today = slotAt(msk(now).day, 0)
  return Array.from({ length: WINDOW_DAYS }, (_, i) => msk(today + i * DAY_MS).day)
}

/** Все часы дня, если день рабочий. */
export function daySlots(day: string): number[] {
  if (!WORK_DAYS.includes(msk(slotAt(day, 12)).weekday)) return []
  return Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => slotAt(day, OPEN_HOUR + i))
}

/** Свободные часы дня: рабочие, ещё не начались, не заняты. */
export function freeSlots(day: string, now: number, taken: number[]): number[] {
  if (!windowDays(now).includes(day)) return []
  return daySlots(day).filter((slot) => slot > now && !taken.includes(slot))
}

/** Дни окна, где остался хотя бы один свободный час. */
export function freeDays(now: number, taken: number[]): string[] {
  return windowDays(now).filter((day) => freeSlots(day, now, taken).length > 0)
}

/** Час можно занять: он из окна, рабочий и ещё не начался. Занятость проверяет база. */
export function isBookable(slot: number, now: number): boolean {
  const day = msk(slot).day
  return slot > now && windowDays(now).includes(day) && daySlots(day).includes(slot)
}

/** Конец окна записи: начало восьмого дня по Москве. */
export function windowEnd(now: number): number {
  return slotAt(msk(now).day, 0) + WINDOW_DAYS * DAY_MS
}

export function dayOf(slot: number): string {
  return msk(slot).day
}

/** «Пятница, 17 октября» */
export function dayLabel(day: string): string {
  const { weekday, month, date } = msk(slotAt(day, 12))
  const name = WEEKDAYS[weekday]
  return `${name[0].toUpperCase()}${name.slice(1)}, ${date} ${MONTHS[month]}`
}

/** «пятница» */
export function weekdayLabel(slot: number): string {
  return WEEKDAYS[msk(slot).weekday]
}

/** «15:00» */
export function timeLabel(slot: number): string {
  return msk(slot).time
}

// ── Кнопки и списки ────────────────────────────────────────────────────

export type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] }

export function daysKeyboard(days: string[]): Keyboard {
  return {
    inline_keyboard: days.map((day) => [{ text: dayLabel(day), callback_data: `day:${day}` }]),
  }
}

export function hoursKeyboard(slots: number[]): Keyboard {
  const rows: Keyboard['inline_keyboard'] = []
  for (let i = 0; i < slots.length; i += 3) {
    rows.push(
      slots
        .slice(i, i + 3)
        .map((slot) => ({ text: timeLabel(slot), callback_data: `slot:${slot}` })),
    )
  }
  return { inline_keyboard: rows }
}

export function cancelKeyboard(slot: number): Keyboard {
  return { inline_keyboard: [[{ text: texts.cancelButton, callback_data: `cancel:${slot}` }]] }
}

/** Ответ на /записи: по дням, внутри дня по часам. */
export function bookingsText(list: { slot: number; name: string }[]): string {
  if (list.length === 0) return texts.bookingsEmpty
  const lines: string[] = []
  let lastDay = ''
  for (const { slot, name } of [...list].sort((a, b) => a.slot - b.slot)) {
    const day = dayOf(slot)
    if (day !== lastDay) {
      lines.push('', dayLabel(day))
      lastDay = day
    }
    lines.push(`${timeLabel(slot)} — ${name}`)
  }
  return texts.bookings(lines.join('\n'))
}

// ── Вебхук и состояние ─────────────────────────────────────────────────

export function isWebhookAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || header === null || header.length !== secret.length) return false
  let diff = 0
  for (let i = 0; i < secret.length; i++) diff |= header.charCodeAt(i) ^ secret.charCodeAt(i)
  return diff === 0
}

/** Что сломано у вебхука, словами канона; null — всё в порядке. */
export function webhookProblem(info: WebhookInfo, expectedUrl: string, now: number): string | null {
  if (!info.url) return texts.reasonNotSet
  if (info.url !== expectedUrl) return texts.reasonWrongUrl(info.url)
  if (info.last_error_date && now - info.last_error_date * 1000 < FRESH_ERROR_MS) {
    return texts.reasonDelivery(info.last_error_message ?? 'без описания')
  }
  return null
}

export function formatMsk(ms: number): string {
  const { day, time } = msk(ms)
  return `${day} ${time} МСК`
}

export type Stats = { chats: number; messagesDay: number; lastMessageAt: number | null }

export function statusText(stats: Stats, problem: string | null): string {
  return texts.status(
    String(stats.chats),
    String(stats.messagesDay),
    stats.lastMessageAt === null ? texts.never : formatMsk(stats.lastMessageAt),
    problem === null ? texts.webhookOk : texts.webhookBroken(problem),
  )
}

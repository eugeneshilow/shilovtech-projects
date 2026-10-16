// @vitest-environment edge-runtime
/// <reference types="vite/client" />
// Сценарии записи на настоящей схеме и функциях Convex (convex-test), Telegram подменён.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { internal } from '../convex/_generated/api'
import { slotAt } from '../convex/logic'
import schema from '../convex/schema'
import { texts } from '../convex/texts'

const modules = import.meta.glob('../convex/**/*.*s')
const MASTER = 100
const IVAN = 200
const MASHA = 300
// Четверг, 15 октября 2026, 14:30 по Москве.
const NOW = slotAt('2026-10-15', 14) + 30 * 60 * 1000
const AT_15 = slotAt('2026-10-15', 15)
const AT_16 = slotAt('2026-10-15', 16)

type Sent = {
  chat_id: number
  text: string
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] }
}
let sent: Sent[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
  vi.stubEnv('MASTER_ID', String(MASTER))
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split('/').pop()
      if (method === 'sendMessage') sent.push(JSON.parse(String(init.body)))
      const result = method === 'getWebhookInfo' ? { url: '', pending_update_count: 0 } : true
      return new Response(JSON.stringify({ ok: true, result }))
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type T = ReturnType<typeof convexTest>
const say = (t: T, chatId: number, command: string, firstName = 'Иван') =>
  t.action(internal.bot.handleUpdate, { incoming: { chatId, firstName, command } })
const press = (t: T, chatId: number, data: string, firstName = 'Иван') =>
  t.action(internal.bot.handleUpdate, {
    incoming: { chatId, firstName, command: null, callbackId: 'cb', callbackData: data },
  })
const to = (chatId: number) => sent.filter((m) => m.chat_id === chatId)
const last = (chatId: number) => to(chatId).at(-1)!
const buttons = (m: Sent) =>
  m.reply_markup?.inline_keyboard.flat().map((b) => b.callback_data) ?? []
const active = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query('bookings')
      .filter((q) => q.eq(q.field('status'), 'active'))
      .collect(),
  )

describe('клиент записывается', () => {
  it('/start → дни → часы → запись, мастеру весть', async () => {
    const t = convexTest(schema, modules)

    await say(t, IVAN, 'start')
    expect(last(IVAN).text).toBe(texts.start)
    expect(buttons(last(IVAN))).toEqual([
      'day:2026-10-15',
      'day:2026-10-16',
      'day:2026-10-17',
      'day:2026-10-19',
      'day:2026-10-20',
      'day:2026-10-21',
    ])

    await press(t, IVAN, 'day:2026-10-15')
    expect(last(IVAN).text).toBe(texts.chooseHour('Четверг, 15 октября'))
    expect(buttons(last(IVAN))[0]).toBe(`slot:${AT_15}`)

    await press(t, IVAN, `slot:${AT_15}`)
    expect(last(IVAN).text).toBe('Записал вас: четверг, 15:00')
    expect(buttons(last(IVAN))).toEqual([`cancel:${AT_15}`])
    expect(to(MASTER).map((m) => m.text)).toEqual(['Новая запись: Иван, четверг 15:00'])
    expect(await active(t)).toHaveLength(1)
  })

  it('занятое время второй клиент не получит', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    await press(t, MASHA, `slot:${AT_15}`, 'Маша')

    expect(last(MASHA).text).toBe(texts.slotTaken)
    expect(buttons(last(MASHA))).not.toContain(`slot:${AT_15}`)
    expect(buttons(last(MASHA))).toContain(`slot:${AT_16}`)
    expect(await active(t)).toHaveLength(1)
    expect(to(MASTER)).toHaveLength(1)
  })

  it('у клиента одна активная запись', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    await press(t, IVAN, `slot:${AT_16}`)

    expect(last(IVAN).text).toBe(texts.alreadyBooked('четверг', '15:00'))
    expect(buttons(last(IVAN))).toEqual([`cancel:${AT_15}`])
    expect(await active(t)).toHaveLength(1)
  })

  it('на прошедшее время записать нельзя', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${slotAt('2026-10-15', 14)}`)
    expect(last(IVAN).text).toBe(texts.slotPast)
    await press(t, IVAN, `slot:${slotAt('2026-10-14', 15)}`)
    expect(last(IVAN).text).toBe(texts.slotPast)
    expect(await active(t)).toHaveLength(0)
    expect(to(MASTER)).toHaveLength(0)
  })

  it('прошла запись — можно записаться снова', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    vi.setSystemTime(slotAt('2026-10-15', 15) + 10 * 60 * 1000)
    await press(t, IVAN, `slot:${AT_16}`)
    expect(last(IVAN).text).toBe('Записал вас: четверг, 16:00')
  })
})

describe('клиент отменяет', () => {
  it('отмена освобождает час и приходит мастеру', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    await press(t, IVAN, `cancel:${AT_15}`)

    expect(last(IVAN).text).toBe('Запись отменена: четверг, 15:00. Записаться снова — /start')
    expect(to(MASTER).at(-1)!.text).toBe('Отмена: Иван, четверг 15:00')
    expect(await active(t)).toHaveLength(0)

    await press(t, MASHA, `slot:${AT_15}`, 'Маша')
    expect(last(MASHA).text).toBe('Записал вас: четверг, 15:00')
  })

  it('старая кнопка отмены не трогает новую запись', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    await press(t, IVAN, `cancel:${AT_15}`)
    await press(t, IVAN, `slot:${AT_16}`)
    await press(t, IVAN, `cancel:${AT_15}`)

    expect(last(IVAN).text).toBe(texts.cancelMissing)
    expect((await active(t)).map((b) => b.slot)).toEqual([AT_16])
  })
})

describe('мастер', () => {
  it('/записи — список мастеру, отказ остальным', async () => {
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    await press(t, MASHA, `slot:${slotAt('2026-10-16', 10)}`, 'Маша')

    await say(t, MASTER, 'записи', 'Мастер')
    expect(last(MASTER).text).toBe(
      'Записи на неделю:\n\nЧетверг, 15 октября\n15:00 — Иван\n\nПятница, 16 октября\n10:00 — Маша',
    )

    await say(t, IVAN, 'записи')
    expect(last(IVAN).text).toBe(texts.masterOnly)
  })

  it('чужой /status получает отказ, мастер — состояние', async () => {
    const t = convexTest(schema, modules)
    await say(t, IVAN, 'status')
    expect(last(IVAN).text).toBe(texts.masterOnly)
    await say(t, MASTER, 'status', 'Мастер')
    expect(last(MASTER).text).toContain('Состояние бота')
  })

  it('без MASTER_ID клиента всё равно записывают', async () => {
    vi.stubEnv('MASTER_ID', '')
    const t = convexTest(schema, modules)
    await press(t, IVAN, `slot:${AT_15}`)
    expect(last(IVAN).text).toBe('Записал вас: четверг, 15:00')
    expect(sent).toHaveLength(1)
  })
})

describe('прочее', () => {
  it('неизвестное слово получает подсказку /start', async () => {
    const t = convexTest(schema, modules)
    await say(t, IVAN, 'привет')
    expect(last(IVAN).text).toBe(texts.fallback)
    expect(texts.fallback).toContain('/start')
  })
})

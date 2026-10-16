import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleTelegramPost } from '../convex/http'
import {
  bookingsText,
  dayLabel,
  daysKeyboard,
  freeDays,
  freeSlots,
  hoursKeyboard,
  isBookable,
  readAction,
  readMessage,
  slotAt,
  statusText,
  timeLabel,
  webhookProblem,
  weekdayLabel,
  type Incoming,
  type TelegramUpdate,
} from '../convex/logic'
import { texts } from '../convex/texts'

// Четверг, 15 октября 2026, 14:30 по Москве.
const NOW = slotAt('2026-10-15', 14) + 30 * 60 * 1000

function message(text: string, chatId = 200, firstName?: string): TelegramUpdate {
  return {
    update_id: 1,
    message: { chat: { id: chatId }, from: { id: chatId, first_name: firstName }, text },
  }
}

function incoming(text: string): Incoming {
  const parsed = readMessage(message(text))
  if (!parsed) throw new Error('сообщение не разобрано')
  return parsed
}

describe('что человек попросил', () => {
  it('команды, включая кириллическую /записи', () => {
    expect(readAction(incoming('/start'))).toEqual({ type: 'start' })
    expect(readAction(incoming('/help@some_bot'))).toEqual({ type: 'help' })
    expect(readAction(incoming('/status'))).toEqual({ type: 'status' })
    expect(readAction(incoming('/записи'))).toEqual({ type: 'bookings' })
    expect(readAction(incoming('привет, как дела?'))).toEqual({ type: 'fallback' })
  })

  it('хвост ссылки после /start становится меткой входа', () => {
    expect(incoming('/start from_youtube').startLabel).toBe('from_youtube')
    expect(incoming('/start').startLabel).toBeUndefined()
    expect(incoming('/start плохая метка').startLabel).toBeUndefined()
  })

  it('кнопки: день, час, отмена; чужая метка — подсказка', () => {
    const press = (data: string) =>
      readAction(
        readMessage({
          update_id: 1,
          callback_query: { id: 'cb', from: { id: 200, first_name: 'Иван' }, data },
        })!,
      )
    expect(press('day:2026-10-16')).toEqual({ type: 'day', day: '2026-10-16' })
    expect(press('slot:1792152000000')).toEqual({ type: 'slot', slot: 1792152000000 })
    expect(press('cancel:1792152000000')).toEqual({ type: 'cancel', slot: 1792152000000 })
    expect(press('day:завтра')).toEqual({ type: 'fallback' })
  })
})

describe('свободное время', () => {
  it('окно — 7 дней с сегодняшнего, воскресенья нет', () => {
    expect(freeDays(NOW, [])).toEqual([
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ])
  })

  it('сегодня — только часы, которые ещё не начались', () => {
    expect(freeSlots('2026-10-15', NOW, []).map(timeLabel)).toEqual([
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '19:00',
    ])
  })

  it('рабочий день целиком — с 10:00 до 19:00, минус занятые', () => {
    const taken = [slotAt('2026-10-16', 12), slotAt('2026-10-16', 15)]
    const free = freeSlots('2026-10-16', NOW, taken).map(timeLabel)
    expect(free).toHaveLength(8)
    expect(free[0]).toBe('10:00')
    expect(free.at(-1)).toBe('19:00')
    expect(free).not.toContain('12:00')
    expect(free).not.toContain('15:00')
  })

  it('занятый целиком день пропадает из кнопок', () => {
    const allFriday = Array.from({ length: 10 }, (_, i) => slotAt('2026-10-16', 10 + i))
    expect(freeDays(NOW, allFriday)).not.toContain('2026-10-16')
  })

  it('записаться можно только на будущий рабочий час из окна', () => {
    expect(isBookable(slotAt('2026-10-15', 15), NOW)).toBe(true)
    expect(isBookable(slotAt('2026-10-15', 14), NOW)).toBe(false)
    expect(isBookable(slotAt('2026-10-14', 15), NOW)).toBe(false)
    expect(isBookable(slotAt('2026-10-18', 12), NOW)).toBe(false)
    expect(isBookable(slotAt('2026-10-16', 20), NOW)).toBe(false)
    expect(isBookable(slotAt('2026-10-16', 9), NOW)).toBe(false)
    expect(isBookable(slotAt('2026-10-22', 12), NOW)).toBe(false)
    expect(isBookable(slotAt('2026-10-16', 12) + 30 * 60 * 1000, NOW)).toBe(false)
  })
})

describe('как бот это пишет', () => {
  it('день, день недели, время — по Москве', () => {
    expect(dayLabel('2026-10-16')).toBe('Пятница, 16 октября')
    expect(weekdayLabel(slotAt('2026-10-16', 15))).toBe('пятница')
    expect(timeLabel(slotAt('2026-10-16', 15))).toBe('15:00')
    expect(texts.booked('пятница', '15:00')).toBe('Записал вас: пятница, 15:00')
    expect(texts.masterBooked('Иван', 'пятница', '15:00')).toBe('Новая запись: Иван, пятница 15:00')
  })

  it('кнопки дней — по одной в ряд, часов — по три', () => {
    const days = daysKeyboard(['2026-10-16', '2026-10-17']).inline_keyboard
    expect(days).toEqual([
      [{ text: 'Пятница, 16 октября', callback_data: 'day:2026-10-16' }],
      [{ text: 'Суббота, 17 октября', callback_data: 'day:2026-10-17' }],
    ])
    const hours = hoursKeyboard(freeSlots('2026-10-15', NOW, [])).inline_keyboard
    expect(hours.map((row) => row.length)).toEqual([3, 2])
  })

  it('/записи — по дням, внутри дня по часам', () => {
    expect(bookingsText([])).toBe(texts.bookingsEmpty)
    expect(
      bookingsText([
        { slot: slotAt('2026-10-17', 10), name: 'Петя' },
        { slot: slotAt('2026-10-16', 16), name: 'Маша' },
        { slot: slotAt('2026-10-16', 15), name: 'Иван' },
      ]),
    ).toBe(
      'Записи на неделю:\n\nПятница, 16 октября\n15:00 — Иван\n16:00 — Маша\n\nСуббота, 17 октября\n10:00 — Петя',
    )
  })
})

describe('состояние вебхука', () => {
  const url = 'https://example.convex.site/telegram'

  it('наш адрес без свежих ошибок — в порядке', () => {
    expect(webhookProblem({ url, pending_update_count: 0 }, url, NOW)).toBeNull()
    const old = NOW / 1000 - 2 * 60 * 60
    expect(
      webhookProblem({ url, pending_update_count: 0, last_error_date: old }, url, NOW),
    ).toBeNull()
  })

  it('пустой адрес, чужой адрес и свежая ошибка — сломан', () => {
    expect(webhookProblem({ url: '', pending_update_count: 0 }, url, NOW)).toBe(texts.reasonNotSet)
    expect(webhookProblem({ url: 'https://x.dev/hook', pending_update_count: 0 }, url, NOW)).toBe(
      texts.reasonWrongUrl('https://x.dev/hook'),
    )
    const fresh = {
      url,
      pending_update_count: 3,
      last_error_date: NOW / 1000 - 60,
      last_error_message: 'Wrong response from the webhook: 500',
    }
    expect(webhookProblem(fresh, url, NOW)).toBe(
      texts.reasonDelivery('Wrong response from the webhook: 500'),
    )
  })

  it('/status пишет время по Москве', () => {
    const text = statusText({ chats: 2, messagesDay: 5, lastMessageAt: NOW }, null)
    expect(text).toContain('Последнее сообщение: 2026-10-15 14:30 МСК')
    expect(text).toContain(`Вебхук: ${texts.webhookOk}`)
  })
})

describe('вебхук', () => {
  const secret = 'test-secret-123'
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function post(header?: string) {
    return new Request('https://example.convex.site/telegram', {
      method: 'POST',
      headers: header === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': header },
      body: JSON.stringify(message('/start', 200, 'Маша')),
    })
  }

  type Ctx = Parameters<typeof handleTelegramPost>[0]

  it('неверный заголовок даёт 401', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', secret)
    const runAfter = vi.fn()
    const ctx = { scheduler: { runAfter } } as unknown as Ctx
    expect((await handleTelegramPost(ctx, post('wrong-secret-12'))).status).toBe(401)
    expect((await handleTelegramPost(ctx, post())).status).toBe(401)
    expect(runAfter).not.toHaveBeenCalled()
  })

  it('без секрета в окружении не пускает никого', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '')
    const ctx = { scheduler: { runAfter: vi.fn() } } as unknown as Ctx
    expect((await handleTelegramPost(ctx, post(''))).status).toBe(401)
  })

  it('верный заголовок даёт 200 и отдаёт работу функции без текста сообщения', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', secret)
    const runAfter = vi.fn()
    const ctx = { scheduler: { runAfter } } as unknown as Ctx
    expect((await handleTelegramPost(ctx, post(secret))).status).toBe(200)
    expect(runAfter).toHaveBeenCalledOnce()
    expect(runAfter.mock.calls[0][2]).toEqual({
      incoming: {
        chatId: 200,
        firstName: 'Маша',
        lastName: undefined,
        username: undefined,
        command: 'start',
        startLabel: undefined,
      },
    })
  })
})

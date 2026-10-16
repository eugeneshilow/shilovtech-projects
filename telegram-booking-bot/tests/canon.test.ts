import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLOSE_HOUR, OPEN_HOUR, WINDOW_DAYS, WORK_DAYS } from '../convex/logic'
import { COMMANDS, texts } from '../convex/texts'

// Канон бота — docs/telegram/README.md. Каждый текст там стоит блоком под заголовком
// «#### `ключ`»; код обязан говорить то же самое слово в слово.
const canon = readFileSync(new URL('../docs/telegram/README.md', import.meta.url), 'utf8')
const blocks = new Map(
  [...canon.matchAll(/^#### `(\w+)`.*\n+```text\n([\s\S]*?)\n```/gm)].map((m) => [m[1], m[2]]),
)

const D = '{день недели}'
const T = '{время}'
const code: Record<string, string> = {
  start: texts.start,
  noDays: texts.noDays,
  chooseHour: texts.chooseHour('{день}'),
  dayFull: texts.dayFull,
  booked: texts.booked(D, T),
  cancelButton: texts.cancelButton,
  slotTaken: texts.slotTaken,
  slotPast: texts.slotPast,
  alreadyBooked: texts.alreadyBooked(D, T),
  cancelled: texts.cancelled(D, T),
  cancelMissing: texts.cancelMissing,
  help: texts.help,
  fallback: texts.fallback,
  masterOnly: texts.masterOnly,
  masterBooked: texts.masterBooked('{имя}', D, T),
  masterCancelled: texts.masterCancelled('{имя}', D, T),
  bookings: texts.bookings('{список}'),
  bookingsEmpty: texts.bookingsEmpty,
  status: texts.status('{чатов}', '{сообщений}', '{когда}', '{вебхук}'),
  broken: texts.broken('{причина}'),
  description: texts.description,
  shortDescription: texts.shortDescription,
  commands: COMMANDS.map((c) => `${c.command} — ${c.description}`).join('\n'),
}

describe('тексты бота совпадают с каноном', () => {
  it('в каноне и в коде одни и те же тексты', () => {
    expect([...blocks.keys()].sort()).toEqual(Object.keys(code).sort())
  })

  for (const [key, text] of Object.entries(code)) {
    it(key, () => {
      expect(text).toBe(blocks.get(key))
    })
  }

  it('мелкие слова канона тоже в коде', () => {
    expect(canon).toContain(`если имени нет — «${texts.defaultName}»`)
    expect(canon).toContain(`«${texts.never}»`)
    expect(canon).toContain(`«${texts.webhookOk}»`)
    expect(canon).toContain(`«${texts.reasonNotSet}»`)
    expect(canon).toContain(`«${texts.reasonWrongUrl('{адрес}')}»`)
    expect(canon).toContain(`«${texts.reasonDelivery('{ошибка}')}»`)
    expect(canon).toContain(`«${texts.webhookBroken('{причина}')}»`)
  })
})

describe('часы работы совпадают с каноном', () => {
  it('пн–сб, с открытия до закрытия, окно в 7 дней', () => {
    expect(WORK_DAYS).toEqual([1, 2, 3, 4, 5, 6])
    expect(canon).toContain('с понедельника по субботу')
    expect(canon).toContain(`с ${OPEN_HOUR}:00 до ${CLOSE_HOUR}:00 по Москве`)
    expect(canon).toContain(`последняя в ${CLOSE_HOUR - 1}:00`)
    expect(canon).toContain(`${WINDOW_DAYS} календарных дней по Москве`)
  })
})

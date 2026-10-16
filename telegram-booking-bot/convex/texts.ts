// Тексты бота — слово в слово из docs/telegram/README.md.
// Меняются сначала там, потом здесь; tests/canon.test.ts сверяет одно с другим.

export const COMMANDS = [
  { command: 'start', description: 'Записаться' },
  { command: 'help', description: 'Что я умею' },
]

export const texts = {
  start: 'Привет! Выберите день',
  noDays: 'Привет! На ближайшие 7 дней свободного времени нет. Загляните позже: /start',
  chooseHour: (day: string) => `${day}: выберите время`,
  dayFull: 'На этот день свободного времени не осталось. Выберите другой день',
  booked: (weekday: string, time: string) => `Записал вас: ${weekday}, ${time}`,
  cancelButton: 'Отменить запись',
  slotTaken: 'Это время уже заняли. Выберите другое',
  slotPast: 'Это время уже прошло. Выберите другое',
  alreadyBooked: (weekday: string, time: string) =>
    `У вас уже есть запись: ${weekday}, ${time}. Чтобы выбрать другое время, сначала отмените её`,
  cancelled: (weekday: string, time: string) =>
    `Запись отменена: ${weekday}, ${time}. Записаться снова — /start`,
  cancelMissing: 'Этой записи уже нет. Записаться — /start',
  help: [
    'Я записываю к мастеру.',
    '/start — выбрать день и время',
    '/help — показать этот список',
    '',
    'Для мастера:',
    '/записи — записи на неделю',
    '/status — состояние бота',
  ].join('\n'),
  fallback: 'Я умею только записывать к мастеру. Нажмите /start, чтобы выбрать день.',
  masterOnly: 'Это видит только мастер.',

  masterBooked: (name: string, weekday: string, time: string) =>
    `Новая запись: ${name}, ${weekday} ${time}`,
  masterCancelled: (name: string, weekday: string, time: string) =>
    `Отмена: ${name}, ${weekday} ${time}`,
  bookings: (list: string) => `Записи на неделю:\n${list}`,
  bookingsEmpty: 'На неделю записей нет.',
  defaultName: 'Клиент',

  status: (chats: string, messagesDay: string, lastAt: string, webhook: string) =>
    `Состояние бота\nЧатов: ${chats}\nСообщений за сутки: ${messagesDay}\nПоследнее сообщение: ${lastAt}\nВебхук: ${webhook}`,
  never: 'ещё не было',
  webhookOk: 'стоит, ошибок нет',
  webhookBroken: (reason: string) => `сломан: ${reason}`,
  broken: (reason: string) =>
    `Бот сломан: ${reason}. Подробности — в логах продакшен-деплоя в панели Convex.`,
  reasonNotSet: 'вебхук не установлен',
  reasonWrongUrl: (url: string) => `вебхук стоит на чужом адресе ${url}`,
  reasonDelivery: (error: string) => `Telegram не смог доставить сообщение: ${error}`,

  description: 'Запись к мастеру. Выберите день и час — бот запишет вас и сразу сообщит мастеру.',
  shortDescription: 'Запись к мастеру в пару нажатий.',
}

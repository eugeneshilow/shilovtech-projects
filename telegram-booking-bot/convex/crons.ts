import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

// Селфхил вебхука — docs/telegram/README.md, раздел «Продакшен».
const crons = cronJobs()

crons.hourly('check-webhook', { minuteUTC: 7 }, internal.bot.checkWebhook)

export default crons

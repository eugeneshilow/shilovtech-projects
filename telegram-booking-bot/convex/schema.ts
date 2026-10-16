import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// Канон таблиц — docs/telegram/README.md, раздел «Что хранится».
// Тексты сообщений не хранятся.
export default defineSchema({
  bookings: defineTable({
    chatId: v.number(),
    name: v.string(),
    slot: v.number(),
    status: v.union(v.literal('active'), v.literal('cancelled')),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
  })
    .index('by_status_slot', ['status', 'slot'])
    .index('by_chat_status', ['chatId', 'status']),
  chats: defineTable({
    chatId: v.number(),
    firstName: v.optional(v.string()),
    username: v.optional(v.string()),
    startLabel: v.optional(v.string()),
    firstMessageAt: v.number(),
    lastMessageAt: v.number(),
    messageCount: v.number(),
    recentMessageTimes: v.array(v.number()),
  }).index('by_chatId', ['chatId']),
})

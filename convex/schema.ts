import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    email: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.number(),
  }).index('by_email', ['email']),

  lessons: defineTable({
    title: v.string(),
    language: v.string(),
    objective: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    status: v.union(
      v.literal('draft'),
      v.literal('planning'),
      v.literal('generating'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    totalDurationMs: v.optional(v.number()),
    sourceJsonPath: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_user', ['userId']),

  topics: defineTable({
    lessonId: v.id('lessons'),
    topicIndex: v.number(),
    title: v.string(),
    brief: v.optional(v.string()),
    status: v.union(
      v.literal('pending'),
      v.literal('scripted'),
      v.literal('voiced'),
      v.literal('timed'),
      v.literal('rendered'),
      v.literal('failed'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_lesson', ['lessonId'])
    .index('by_lesson_and_index', ['lessonId', 'topicIndex']),

  topicScripts: defineTable({
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    language: v.string(),
    transcript: v.string(),
    translatedFrom: v.optional(v.string()),
    narrationStyle: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_topic', ['topicId'])
    .index('by_lesson', ['lessonId']),

  audioAssets: defineTable({
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    provider: v.string(),
    voiceModel: v.string(),
    storageId: v.optional(v.id('_storage')),
    storagePath: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    durationMs: v.number(),
    sampleRate: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_topic', ['topicId'])
    .index('by_lesson', ['lessonId']),

  timingTracks: defineTable({
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    frameRate: v.number(),
    cues: v.array(
      v.object({
        token: v.string(),
        startMs: v.number(),
        endMs: v.number(),
        sceneId: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  })
    .index('by_topic', ['topicId'])
    .index('by_lesson', ['lessonId']),

  scenePlans: defineTable({
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    sceneId: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    htmlSpec: v.string(),
    animationSpec: v.string(),
    interactionSpec: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_topic', ['topicId'])
    .index('by_lesson', ['lessonId']),

  generationRuns: defineTable({
    lessonId: v.id('lessons'),
    runType: v.union(
      v.literal('profile'),
      v.literal('plan'),
      v.literal('topic'),
      v.literal('tts'),
      v.literal('timing'),
      v.literal('scene'),
      v.literal('qa'),
    ),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('succeeded'),
      v.literal('failed'),
    ),
    agentName: v.string(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index('by_lesson', ['lessonId']),

  courseProfiles: defineTable({
    lessonId: v.id('lessons'),
    topic: v.string(),
    objective: v.optional(v.string()),
    courseSummary: v.string(),
    learnerLevel: v.union(
      v.literal('beginner'),
      v.literal('intermediate'),
      v.literal('advanced'),
      v.literal('mixed'),
    ),
    confidenceScore: v.number(),
    diagnosticAccuracy: v.number(),
    answeredCount: v.number(),
    profileSummary: v.string(),
    strengthsJson: v.string(),
    gapsJson: v.string(),
    generatorNotesJson: v.string(),
    preferencesJson: v.string(),
    diagnosticAnswersJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_lesson', ['lessonId']),
})
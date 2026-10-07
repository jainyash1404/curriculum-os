import { actionGeneric, mutationGeneric, queryGeneric } from 'convex/server'
import { v } from 'convex/values'

const lessonStatus = v.union(
  v.literal('draft'),
  v.literal('planning'),
  v.literal('generating'),
  v.literal('ready'),
  v.literal('failed'),
)

const topicStatus = v.union(
  v.literal('pending'),
  v.literal('scripted'),
  v.literal('voiced'),
  v.literal('timed'),
  v.literal('rendered'),
  v.literal('failed'),
)

const runStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('succeeded'),
  v.literal('failed'),
)

const cueValidator = v.object({
  token: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  sceneId: v.optional(v.string()),
})

const sceneValidator = v.object({
  sceneId: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  htmlSpec: v.string(),
  animationSpec: v.string(),
  interactionSpec: v.optional(v.string()),
})

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const normalized = base64.includes(',')
    ? (base64.split(',').at(-1) ?? '')
    : base64
  const binary = atob(normalized)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return buffer
}

export const createLesson = mutationGeneric({
  args: {
    title: v.string(),
    language: v.string(),
    objective: v.optional(v.string()),
    sourceJsonPath: v.optional(v.string()),
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const lessonId = await ctx.db.insert('lessons', {
      title: args.title,
      language: args.language,
      objective: args.objective,
      sourceJsonPath: args.sourceJsonPath,
      userId: args.userId,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })
    return { lessonId }
  },
})

export const updateLessonMetadata = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    title: v.optional(v.string()),
    objective: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: {
      updatedAt: number
      title?: string
      objective?: string
    } = {
      updatedAt: Date.now(),
    }

    if (args.title !== undefined) {
      patch.title = args.title
    }
    if (args.objective !== undefined) {
      patch.objective = args.objective
    }

    await ctx.db.patch(args.lessonId, patch)
    return { ok: true }
  },
})

export const setLessonStatus = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    status: lessonStatus,
    totalDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: {
      status: 'draft' | 'planning' | 'generating' | 'ready' | 'failed'
      updatedAt: number
      totalDurationMs?: number
    } = {
      status: args.status,
      updatedAt: Date.now(),
    }

    if (args.totalDurationMs !== undefined) {
      patch.totalDurationMs = args.totalDurationMs
    }

    await ctx.db.patch(args.lessonId, patch)
    return { ok: true }
  },
})

export const createTopic = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    topicIndex: v.number(),
    title: v.string(),
    brief: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const topicId = await ctx.db.insert('topics', {
      lessonId: args.lessonId,
      topicIndex: args.topicIndex,
      title: args.title,
      brief: args.brief,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    return { topicId }
  },
})

export const setTopicStatus = mutationGeneric({
  args: {
    topicId: v.id('topics'),
    status: topicStatus,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.topicId, {
      status: args.status,
      updatedAt: Date.now(),
    })
    return { ok: true }
  },
})

export const saveTopicScript = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    language: v.string(),
    transcript: v.string(),
    translatedFrom: v.optional(v.string()),
    narrationStyle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query('topicScripts')
      .withIndex('by_topic', (q) => q.eq('topicId', args.topicId))
      .collect()

    await Promise.all(previous.map((doc) => ctx.db.delete(doc._id)))

    const scriptId = await ctx.db.insert('topicScripts', {
      lessonId: args.lessonId,
      topicId: args.topicId,
      language: args.language,
      transcript: args.transcript,
      translatedFrom: args.translatedFrom,
      narrationStyle: args.narrationStyle,
      createdAt: Date.now(),
    })
    return { scriptId }
  },
})

export const saveTimingTrack = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    frameRate: v.number(),
    cues: v.array(cueValidator),
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query('timingTracks')
      .withIndex('by_topic', (q) => q.eq('topicId', args.topicId))
      .collect()

    await Promise.all(previous.map((doc) => ctx.db.delete(doc._id)))

    const trackId = await ctx.db.insert('timingTracks', {
      lessonId: args.lessonId,
      topicId: args.topicId,
      frameRate: args.frameRate,
      cues: args.cues,
      createdAt: Date.now(),
    })
    return { trackId }
  },
})

export const saveScenePlans = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    scenes: v.array(sceneValidator),
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query('scenePlans')
      .withIndex('by_topic', (q) => q.eq('topicId', args.topicId))
      .collect()

    await Promise.all(previous.map((doc) => ctx.db.delete(doc._id)))

    const now = Date.now()
    const sceneIds = await Promise.all(
      args.scenes.map((scene) =>
        ctx.db.insert('scenePlans', {
          lessonId: args.lessonId,
          topicId: args.topicId,
          sceneId: scene.sceneId,
          startMs: scene.startMs,
          endMs: scene.endMs,
          htmlSpec: scene.htmlSpec,
          animationSpec: scene.animationSpec,
          interactionSpec: scene.interactionSpec,
          createdAt: now,
        }),
      ),
    )

    return { sceneIds }
  },
})

export const saveAudioAsset = mutationGeneric({
  args: {
    lessonId: v.id('lessons'),
    topicId: v.id('topics'),
    provider: v.string(),
    voiceModel: v.string(),
    durationMs: v.number(),
    sampleRate: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    storagePath: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query('audioAssets')
      .withIndex('by_topic', (q) => q.eq('topicId', args.topicId))
      .collect()

    await Promise.all(previous.map((doc) => ctx.db.delete(doc._id)))

    const audioId = await ctx.db.insert('audioAssets', {
      lessonId: args.lessonId,
      topicId: args.topicId,
      provider: args.provider,
      voiceModel: args.voiceModel,
      durationMs: args.durationMs,
      sampleRate: args.sampleRate,
      mimeType: args.mimeType,
      storageId: args.storageId,
      storagePath: args.storagePath,
      externalUrl: args.externalUrl,
      createdAt: Date.now(),
    })

    return { audioId }
  },
})

export const createGenerationRun = mutationGeneric({
  args: {
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
    status: runStatus,
    agentName: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert('generationRuns', {
      lessonId: args.lessonId,
      runType: args.runType,
      status: args.status,
      agentName: args.agentName,
      error: args.error,
      startedAt: args.status === 'running' ? Date.now() : undefined,
      finishedAt:
        args.status === 'succeeded' || args.status === 'failed'
          ? Date.now()
          : undefined,
    })
    return { runId }
  },
})

export const saveCourseProfile = mutationGeneric({
  args: {
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
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query('courseProfiles')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()

    await Promise.all(previous.map((doc) => ctx.db.delete(doc._id)))

    const now = Date.now()
    const profileId = await ctx.db.insert('courseProfiles', {
      lessonId: args.lessonId,
      topic: args.topic,
      objective: args.objective,
      courseSummary: args.courseSummary,
      learnerLevel: args.learnerLevel,
      confidenceScore: args.confidenceScore,
      diagnosticAccuracy: args.diagnosticAccuracy,
      answeredCount: args.answeredCount,
      profileSummary: args.profileSummary,
      strengthsJson: args.strengthsJson,
      gapsJson: args.gapsJson,
      generatorNotesJson: args.generatorNotesJson,
      preferencesJson: args.preferencesJson,
      diagnosticAnswersJson: args.diagnosticAnswersJson,
      createdAt: now,
      updatedAt: now,
    })

    return { profileId }
  },
})

export const updateGenerationRun = mutationGeneric({
  args: {
    runId: v.id('generationRuns'),
    status: runStatus,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      error: args.error,
      startedAt: args.status === 'running' ? Date.now() : undefined,
      finishedAt:
        args.status === 'succeeded' || args.status === 'failed'
          ? Date.now()
          : undefined,
    })
    return { ok: true }
  },
})

export const storeAudioFromBase64 = actionGeneric({
  args: {
    base64: v.string(),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const audioBuffer = decodeBase64ToArrayBuffer(args.base64)
    const blob = new Blob([audioBuffer], {
      type: args.mimeType ?? 'audio/mpeg',
    })
    const storageId = await ctx.storage.store(blob)
    const storageUrl = await ctx.storage.getUrl(storageId)
    return {
      storageId,
      storageUrl,
      bytesLength: audioBuffer.byteLength,
    }
  },
})

export const listLessons = queryGeneric({
  args: {
    limit: v.optional(v.number()),
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20
    if (args.userId) {
      return ctx.db
        .query('lessons')
        .withIndex('by_user', (q) => q.eq('userId', args.userId))
        .order('desc')
        .take(limit)
    }
    const lessons = await ctx.db.query('lessons').order('desc').take(limit)
    return lessons
  },
})

export const getLessonBundle = queryGeneric({
  args: {
    lessonId: v.id('lessons'),
  },
  handler: async (ctx, args) => {
    const lesson = await ctx.db.get(args.lessonId)
    if (!lesson) {
      return null
    }

    const courseProfiles = await ctx.db
      .query('courseProfiles')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()

    const latestProfile =
      courseProfiles.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null

    const topics = await ctx.db
      .query('topics')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()

    const orderedTopics = [...topics].sort(
      (a, b) => a.topicIndex - b.topicIndex,
    )

    const topicBundles = await Promise.all(
      orderedTopics.map(async (topic) => {
        const [scripts, audios, tracks, scenes] = await Promise.all([
          ctx.db
            .query('topicScripts')
            .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
            .collect(),
          ctx.db
            .query('audioAssets')
            .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
            .collect(),
          ctx.db
            .query('timingTracks')
            .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
            .collect(),
          ctx.db
            .query('scenePlans')
            .withIndex('by_topic', (q) => q.eq('topicId', topic._id))
            .collect(),
        ])

        const latestScript =
          scripts.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
        const latestAudio =
          audios.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
        const latestTrack =
          tracks.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
        const orderedScenes = scenes.sort((a, b) => a.startMs - b.startMs)

        const storageUrl =
          latestAudio?.storageId !== undefined
            ? await ctx.storage.getUrl(latestAudio.storageId)
            : null

        return {
          topic,
          script: latestScript,
          audio: latestAudio
            ? {
                ...latestAudio,
                playbackUrl: storageUrl ?? latestAudio.externalUrl ?? null,
              }
            : null,
          timing: latestTrack,
          scenes: orderedScenes,
        }
      }),
    )

    return {
      lesson,
      courseProfile: latestProfile
        ? {
            topic: latestProfile.topic,
            objective: latestProfile.objective,
            courseSummary: latestProfile.courseSummary,
            learnerLevel: latestProfile.learnerLevel,
            confidenceScore: latestProfile.confidenceScore,
            diagnosticAccuracy: latestProfile.diagnosticAccuracy,
            answeredCount: latestProfile.answeredCount,
            profileSummary: latestProfile.profileSummary,
            strengths: JSON.parse(latestProfile.strengthsJson) as Array<string>,
            gaps: JSON.parse(latestProfile.gapsJson) as Array<string>,
            generatorNotes: JSON.parse(
              latestProfile.generatorNotesJson,
            ) as Array<string>,
            preferences: JSON.parse(latestProfile.preferencesJson) as {
              pace: Array<string>
              depth: Array<string>
              format: Array<string>
              interactivity: Array<string>
              assessment: Array<string>
              structurePreference?: string
              customNotes?: string
            },
          }
        : null,
      topics: topicBundles,
    }
  },
})

/**
 * Phase 3, item 11 — analytics dashboard.
 *
 * Deliberately built as an aggregate query over data the pipeline already
 * writes (lessons, courseProfiles, generationRuns) rather than adding a new
 * events table + client-side event-firing plumbing. That keeps this safe
 * to ship without a schema migration risk, at the cost of not tracking
 * things the pipeline doesn't already record (e.g. per-second watch time).
 * If deeper analytics are needed later, add an `events` table and log
 * granular player events into it — this query is written so a later swap
 * only touches this one function, not the dashboard UI.
 */
export const getAnalyticsSummary = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const lessons = await ctx.db.query('lessons').collect()
    const profiles = await ctx.db.query('courseProfiles').collect()
    const runs = await ctx.db.query('generationRuns').collect()

    // Maps (not plain object index access) so TS correctly types lookups
    // as possibly-undefined — matches the strict tsconfig actually in use
    // (no `noUncheckedIndexedAccess`, so `Record<string,T>[key]` would
    // otherwise be typed as always-defined, which it isn't here).
    const statusCounts = new Map<string, number>()
    for (const l of lessons) {
      statusCounts.set(l.status, (statusCounts.get(l.status) ?? 0) + 1)
    }

    const levelCounts = new Map<string, number>()
    let accuracySum = 0
    let confidenceSum = 0
    for (const p of profiles) {
      levelCounts.set(
        p.learnerLevel,
        (levelCounts.get(p.learnerLevel) ?? 0) + 1,
      )
      accuracySum += p.diagnosticAccuracy
      confidenceSum += p.confidenceScore
    }

    const stageCounts = new Map<
      string,
      { succeeded: number; failed: number }
    >()
    for (const r of runs) {
      const bucket = stageCounts.get(r.runType) ?? {
        succeeded: 0,
        failed: 0,
      }
      if (r.status === 'succeeded') bucket.succeeded += 1
      if (r.status === 'failed') bucket.failed += 1
      stageCounts.set(r.runType, bucket)
    }

    return {
      totalLessons: lessons.length,
      statusCounts: Object.fromEntries(statusCounts),
      levelCounts: Object.fromEntries(levelCounts),
      averageDiagnosticAccuracy:
        profiles.length > 0 ? accuracySum / profiles.length : null,
      averageProfileConfidence:
        profiles.length > 0 ? confidenceSum / profiles.length : null,
      stageCounts: Object.fromEntries(stageCounts),
      recentLessons: [...lessons]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((l) => ({
          id: l._id,
          title: l.title,
          status: l.status,
          language: l.language,
          createdAt: l.createdAt,
        })),
    }
  },
})

/**
 * Deletes a lesson and every row that references it — topics, scripts,
 * audio assets (including the underlying Convex-stored file, not just the
 * row), timing tracks, scene plans, generation run logs, and the course
 * profile. All child tables have a `by_lesson` index specifically so this
 * can query-and-delete each set directly rather than walking through
 * topics one at a time.
 *
 * This is a real, permanent delete — not a status flag — because the
 * feature this backs is "let me clean up test/junk lessons," and a soft
 * delete would leave them cluttering the analytics dashboard and Convex
 * storage quota for no reason.
 */
export const deleteLesson = mutationGeneric({
  args: { lessonId: v.id('lessons'), requestingUserId: v.optional(v.id('users')) },
  handler: async (ctx, args) => {
    const lesson = await ctx.db.get(args.lessonId)
    if (!lesson) {
      // Already gone — treat as success rather than erroring, so a
      // double-click or a stale UI list doesn't surface a scary error.
      return { deleted: true }
    }
    // Ownership check: a lesson with no owner (e.g. the baked /demo
    // export, or anything created before auth existed) is treated as
    // unowned/admin-only — only an explicitly matching userId can delete
    // an owned lesson.
    if (lesson.userId && lesson.userId !== args.requestingUserId) {
      throw new Error('You do not have permission to delete this course.')
    }

    const topics = await ctx.db
      .query('topics')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()

    const audioAssets = await ctx.db
      .query('audioAssets')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()
    for (const asset of audioAssets) {
      if (asset.storageId) {
        await ctx.storage.delete(asset.storageId)
      }
      await ctx.db.delete(asset._id)
    }

    const scriptRows = await ctx.db
      .query('topicScripts')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()
    for (const row of scriptRows) await ctx.db.delete(row._id)

    const timingRows = await ctx.db
      .query('timingTracks')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()
    for (const row of timingRows) await ctx.db.delete(row._id)

    const sceneRows = await ctx.db
      .query('scenePlans')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()
    for (const row of sceneRows) await ctx.db.delete(row._id)

    const runRows = await ctx.db
      .query('generationRuns')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()
    for (const row of runRows) await ctx.db.delete(row._id)

    const profileRows = await ctx.db
      .query('courseProfiles')
      .withIndex('by_lesson', (q) => q.eq('lessonId', args.lessonId))
      .collect()
    for (const row of profileRows) await ctx.db.delete(row._id)

    for (const topic of topics) await ctx.db.delete(topic._id)

    await ctx.db.delete(args.lessonId)

    return { deleted: true }
  },
})
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { buildCourseProfile, generateDiagnosticQuestions } from './agents'
import {
  deleteLesson,
  fetchLessonBundle,
  getAnalyticsSummary,
  listLessonSummaries,
  rewriteTopicScriptForLanguage,
  runLessonPipeline,
} from './runner'
import { synthesizeWithSarvam } from './sarvam'
import type { LessonBundle, PipelineRunResult } from './types'
import { getAppSession } from '@/lib/auth/session'

/**
 * Minimal in-memory rate limiter for AI-calling server functions.
 *
 * Why: `runLessonPipelineServerFn` and `generateDiagnosticQuestionsServerFn`
 * fan out to paid Gemini/Sarvam API calls. Without a guard, a single client
 * (or a scripted retry loop) can exhaust the API quota for every user.
 *
 * This is intentionally simple (sliding window, per-process memory) so it
 * has zero new infra dependencies. On serverless platforms with multiple
 * concurrent instances it limits per-instance, not globally — good enough
 * as a first line of defense; swap for a Redis/Upstash-backed limiter
 * before real production traffic.
 */
const RATE_LIMIT_WINDOW_MS = 60_000
const requestLog = new Map<string, Array<number>>()

function checkRateLimit(key: string, maxRequests: number): void {
  const now = Date.now()
  const timestamps = (requestLog.get(key) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )

  if (timestamps.length >= maxRequests) {
    const retryInMs = RATE_LIMIT_WINDOW_MS - (now - timestamps[0])
    throw new Error(
      `Rate limit reached (${maxRequests}/min). Try again in ${Math.ceil(retryInMs / 1000)}s.`,
    )
  }

  timestamps.push(now)
  requestLog.set(key, timestamps)
}

const runPipelineInputSchema = z.object({
  sourceJson: z.string().min(2).optional(),
  courseTopic: z.string().min(2).optional(),
  courseObjective: z.string().min(2).optional(),
  targetLanguage: z.string().min(2),
  voice: z.string().optional(),
  diagnosticAnswers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        questionPrompt: z.string().min(2),
        concept: z.string().min(1),
        difficulty: z.enum(['basic', 'intermediate', 'advanced']).optional(),
        selectedOptionIndex: z.number().int().min(0),
        correctOptionIndex: z.number().int().min(0),
      }),
    )
    .optional(),
  learningPreferences: z
    .object({
      pace: z.array(z.string()),
      depth: z.array(z.string()),
      format: z.array(z.string()),
      interactivity: z.array(z.string()),
      assessment: z.array(z.string()),
      structurePreference: z.string().optional(),
      customNotes: z.string().optional(),
    })
    .optional(),
})

const lessonIdSchema = z.object({
  lessonId: z.string().min(1),
})

const listLessonsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
})

const diagnosticInputSchema = z.object({
  topic: z.string().min(2),
  objective: z.string().optional(),
  count: z.number().int().min(6).max(16).optional(),
  focusConcepts: z.array(z.string()).optional(),
})

const profileInputSchema = z.object({
  topic: z.string().min(2),
  objective: z.string().optional(),
  targetLanguage: z.string().min(2),
  diagnosticAnswers: z.array(
    z.object({
      questionId: z.string().min(1),
      questionPrompt: z.string().min(2),
      concept: z.string().min(1),
      difficulty: z.enum(['basic', 'intermediate', 'advanced']).optional(),
      selectedOptionIndex: z.number().int().min(0),
      correctOptionIndex: z.number().int().min(0),
    }),
  ),
  learningPreferences: z.object({
    pace: z.array(z.string()),
    depth: z.array(z.string()),
    format: z.array(z.string()),
    interactivity: z.array(z.string()),
    assessment: z.array(z.string()),
    structurePreference: z.string().optional(),
    customNotes: z.string().optional(),
  }),
})

export const runLessonPipelineServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => runPipelineInputSchema.parse(input))
  .handler(async ({ data }): Promise<PipelineRunResult> => {
    // Full-course generation is the most expensive call in the app
    // (script + TTS + scene generation across every topic) — capped tighter.
    checkRateLimit('run-pipeline', 5)

    const session = await getAppSession()
    const userId = session.data.userId
    if (!userId) {
      throw new Error('Sign in to generate a course.')
    }

    return runLessonPipeline({ ...data, userId })
  })

export const getLessonBundleServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => lessonIdSchema.parse(input))
  .handler(async ({ data }): Promise<LessonBundle | null> => {
    const bundle = await fetchLessonBundle(data.lessonId)
    return bundle
  })

export const listLessonsServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => listLessonsSchema.parse(input))
  .handler(async ({ data }) => {
    const session = await getAppSession()
    const userId = session.data.userId
    // No signed-in user → empty list rather than every user's courses.
    // (The zero-config /demo page is unaffected — it reads a static JSON
    // file directly and never calls this function.)
    if (!userId) return []
    return listLessonSummaries(data.limit ?? 20, userId)
  })

const deleteLessonInputSchema = z.object({
  lessonId: z.string().min(1),
})

export const deleteLessonServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => deleteLessonInputSchema.parse(input))
  .handler(async ({ data }) => {
    checkRateLimit('delete-lesson', 20)
    const session = await getAppSession()
    return deleteLesson(data.lessonId, session.data.userId)
  })

/* ─── Analytics dashboard (Phase 3, item 11) ─── */
export const getAnalyticsSummaryServerFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    return getAnalyticsSummary()
  })

/* ─── Mid-playback language switch (Phase 3, item 10) ───
 * Reuses the pipeline's own translation step (rewriteTopicScriptForLanguage,
 * same function the generation pipeline calls) plus the Sarvam TTS call
 * already used for the initial narration and the voice preview above —
 * no new AI pathway, just the existing ones invoked on demand for one
 * topic instead of the whole course.
 *
 * Caveat (surfaced to the user in the UI, not hidden here): the returned
 * audio's *duration* will differ from the original once translated, so
 * the existing scene timing cues are only an approximation in the new
 * language rather than a frame-accurate resync.
 */
const switchLanguageInputSchema = z.object({
  script: z.string().min(1).max(4000),
  targetLanguage: z.string().min(2),
  voice: z.string().optional(),
})

export const switchTopicLanguageServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => switchLanguageInputSchema.parse(input))
  .handler(async ({ data }) => {
    checkRateLimit('switch-language', 10)
    const translated = await rewriteTopicScriptForLanguage({
      script: data.script,
      targetLanguage: data.targetLanguage,
    })
    if (!process.env.SARVAM_API_KEY) {
      throw new Error(
        'Language switch needs SARVAM_API_KEY set on the server.',
      )
    }
    const audio = await synthesizeWithSarvam({
      text: translated,
      language: data.targetLanguage,
      voice: data.voice,
    })
    return { translatedScript: translated, audio }
  })

export const generateDiagnosticQuestionsServerFn = createServerFn({
  method: 'POST',
})
  .inputValidator((input: unknown) => diagnosticInputSchema.parse(input))
  .handler(async ({ data }) => {
    checkRateLimit('diagnostic-questions', 15)
    return generateDiagnosticQuestions({
      topic: data.topic,
      objective: data.objective,
      count: data.count,
      focusConcepts: data.focusConcepts,
    })
  })

export const buildCourseProfileServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => profileInputSchema.parse(input))
  .handler(async ({ data }) => {
    checkRateLimit('build-profile', 10)
    return buildCourseProfile({
      topic: data.topic,
      objective: data.objective,
      targetLanguage: data.targetLanguage,
      diagnosticAnswers: data.diagnosticAnswers,
      learningPreferences: data.learningPreferences,
    })
  })

/* ─── Voice preview (Phase 2, item 6) ───
 * Landing-page "hear a sample" button. Deliberately capped to a short,
 * fixed line rather than free-text input — this is a marketing preview,
 * not a general TTS proxy, so it shouldn't become an unlimited-length
 * synthesis endpoint anyone can call.
 */
const voicePreviewInputSchema = z.object({
  language: z.string().min(2),
  voice: z.string().optional(),
})

const PREVIEW_LINES: Record<string, string> = {
  english: 'Every learner is different. Every lesson should be too.',
  hindi: 'हर सीखने वाला अलग है। हर पाठ भी वैसा ही होना चाहिए।',
  tamil: 'ஒவ்வொரு கற்பவரும் வேறுபட்டவர். ஒவ்வொரு பாடமும் அப்படியே இருக்க வேண்டும்.',
  telugu: 'ప్రతి అభ్యాసకుడు భిన్నంగా ఉంటాడు. ప్రతి పాఠం కూడా అలాగే ఉండాలి.',
}

export const getVoicePreviewServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => voicePreviewInputSchema.parse(input))
  .handler(async ({ data }) => {
    checkRateLimit('voice-preview', 20)
    const language = data.language.toLowerCase()
    const text = PREVIEW_LINES[language] ?? PREVIEW_LINES.english

    if (!process.env.SARVAM_API_KEY) {
      // Fail loudly with a clear, actionable message instead of a raw
      // fetch/auth error — this is the first thing a visitor without keys
      // configured will hit, so the message has to be self-explanatory.
      throw new Error(
        'Voice preview needs SARVAM_API_KEY set on the server. Add it to .env.local and restart.',
      )
    }

    const result = await synthesizeWithSarvam({
      text,
      language: data.language,
      voice: data.voice,
    })

    return { ...result, previewText: text }
  })
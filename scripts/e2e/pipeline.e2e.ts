import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import type { PipelineDeps } from '@/lib/pipeline/runner'
import { fetchLessonBundle, runLessonPipeline } from '@/lib/pipeline/runner'

type Mode = 'sim' | 'live'

type MutationCall = {
  name: string
  args: Record<string, unknown>
}

type LessonRecord = {
  lessonId: string
  status: string
  totalDurationMs?: number
}

function parseArgValue(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`))
  if (inline) {
    return inline.slice(name.length + 3)
  }
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) {
    return process.argv[index + 1]
  }
  return undefined
}

function parseMode(): Mode {
  const value = (parseArgValue('mode') ?? 'sim').toLowerCase()
  if (value === 'live') {
    return 'live'
  }
  return 'sim'
}

function parseFixturePath(): string {
  return parseArgValue('fixture') ?? './scripts/e2e/fixtures/live-source.json'
}

function createSimDeps() {
  let lessonCounter = 0
  let topicCounter = 0
  let runCounter = 0

  const mutationCalls: Array<MutationCall> = []
  const lessons = new Map<string, LessonRecord>()

  const callMutation = ((name: string, args: Record<string, unknown>) => {
    mutationCalls.push({ name, args })

    switch (name) {
      case 'lessons:createLesson': {
        lessonCounter += 1
        const lessonId = `lesson-${lessonCounter}`
        lessons.set(lessonId, {
          lessonId,
          status: 'draft',
        })
        return Promise.resolve({ lessonId })
      }
      case 'lessons:setLessonStatus': {
        const lessonId = String(args.lessonId)
        const lesson = lessons.get(lessonId)
        if (lesson) {
          lesson.status = String(args.status)
          if (typeof args.totalDurationMs === 'number') {
            lesson.totalDurationMs = args.totalDurationMs
          }
        }
        return Promise.resolve({ ok: true })
      }
      case 'lessons:updateLessonMetadata':
      case 'lessons:saveCourseProfile':
        return Promise.resolve({ ok: true })
      case 'lessons:createTopic': {
        topicCounter += 1
        return Promise.resolve({ topicId: `topic-${topicCounter}` })
      }
      case 'lessons:createGenerationRun': {
        runCounter += 1
        return Promise.resolve({ runId: `run-${runCounter}` })
      }
      case 'lessons:updateGenerationRun':
      case 'lessons:setTopicStatus':
      case 'lessons:saveTopicScript':
      case 'lessons:saveAudioAsset':
      case 'lessons:saveTimingTrack':
      case 'lessons:saveScenePlans':
        return Promise.resolve({ ok: true })
      default:
        return Promise.reject(
          new Error(`Unhandled mutation in sim e2e: ${name}`),
        )
    }
  }) as PipelineDeps['callMutation']

  const deps: Partial<PipelineDeps> = {
    callMutation,
    callAction: (() =>
      Promise.resolve({ ok: true })) as PipelineDeps['callAction'],
    callQuery: (() => Promise.resolve(null)) as PipelineDeps['callQuery'],
    planTopics: ({ title }) =>
      Promise.resolve({
        lessonTitle: `${title} Planned`,
        objective: 'Teach clearly',
        topics: [
          { title: 'TLS Basics', brief: 'Handshake and trust' },
          { title: 'Encryption Flow', brief: 'Session keys and integrity' },
        ],
      }),
    generateTopicScript: ({ topic }) =>
      Promise.resolve(
        `${topic.title} ` +
          'clear narration for e2e '.repeat(110) +
          'to guarantee enough duration for timing and scenes',
      ),
    profileLearner: () =>
      Promise.resolve({
        profileSummary:
          'Intermediate learner with strong preference for examples.',
        learnerLevel: 'intermediate',
        confidenceScore: 0.81,
        diagnosticAccuracy: 0.63,
        answeredCount: 10,
        strengths: ['Core understanding'],
        gaps: ['Deep edge-case handling'],
        generatorNotes: ['Use interactive examples and short concept checks.'],
      }),
    translateScript: ({ script }) =>
      Promise.resolve({
        finalScript: script,
      }),
    generateScenes: ({ durationMs }) =>
      Promise.resolve([
        {
          sceneId: 'scene-1',
          startMs: 0,
          endMs: Math.max(1000, Math.floor(durationMs / 2)),
          htmlSpec:
            '<!doctype html><html><body><div>Sim Scene A</div></body></html>',
          animationSpec: '{"mode":"sim-scene"}',
          interactionSpec: 'toggle',
        },
        {
          sceneId: 'scene-2',
          startMs: Math.max(1000, Math.floor(durationMs / 2)),
          endMs: durationMs,
          htmlSpec:
            '<!doctype html><html><body><div>Sim Scene B</div></body></html>',
          animationSpec: '{"mode":"sim-scene"}',
          interactionSpec: 'slider',
        },
      ]),
    synthesizeAudio: ({ text }) =>
      Promise.resolve({
        voiceModel: 'bulbul:v3',
        mimeType: 'audio/mpeg',
        durationMs: Math.max(3000, Math.round(text.split(/\s+/).length * 240)),
        storageId: 'storage-sim',
        storagePath: 'https://storage.example/sim.mp3',
      }),
    sleep: () => Promise.resolve(),
    maxRetries: 1,
    retryBaseDelayMs: 20,
    topicConcurrency: 2,
  }

  return {
    deps,
    mutationCalls,
    lessons,
  }
}

function validateSync(
  bundle: Awaited<ReturnType<typeof fetchLessonBundle>>,
): asserts bundle is NonNullable<
  Awaited<ReturnType<typeof fetchLessonBundle>>
> {
  assert(bundle, 'Lesson bundle must exist')
  assert(bundle.topics.length > 0, 'Bundle must contain topics')

  for (const [index, topicBundle] of bundle.topics.entries()) {
    assert(
      topicBundle.topic.status === 'rendered',
      `Topic ${index + 1} not rendered`,
    )
    assert(topicBundle.audio, `Topic ${index + 1} missing audio`)
    assert(
      topicBundle.audio.playbackUrl,
      `Topic ${index + 1} missing playback URL`,
    )
    assert(topicBundle.timing, `Topic ${index + 1} missing timing track`)
    assert(
      topicBundle.timing.cues.length > 0,
      `Topic ${index + 1} missing cues`,
    )
    assert(topicBundle.scenes.length > 0, `Topic ${index + 1} missing scenes`)

    const durationMs = topicBundle.audio.durationMs
    const lastCue = topicBundle.timing.cues.at(-1)
    const lastScene = topicBundle.scenes.at(-1)

    assert(lastCue, `Topic ${index + 1} missing final cue`)
    assert(lastScene, `Topic ${index + 1} missing final scene`)

    const cueDrift = Math.abs(lastCue.endMs - durationMs)
    const sceneDrift = Math.abs(lastScene.endMs - durationMs)

    assert(
      cueDrift <= 2200,
      `Topic ${index + 1} cue drift too high: ${cueDrift}ms`,
    )
    assert(
      sceneDrift <= 2200,
      `Topic ${index + 1} scene drift too high: ${sceneDrift}ms`,
    )
  }
}

async function runSimMode(): Promise<void> {
  const harness = createSimDeps()
  const sourceJson = await readFile(
    resolve('./scripts/e2e/fixtures/live-source.json'),
    'utf8',
  )

  const result = await runLessonPipeline(
    {
      sourceJson,
      targetLanguage: 'english',
      voice: 'bulbul:v3',
    },
    harness.deps,
  )

  assert(result.topics.length > 0, 'Pipeline produced zero topics in sim mode')
  assert(
    result.topics.every((topic) => topic.status === 'rendered'),
    'All sim topics should be rendered',
  )

  const lesson = harness.lessons.get(result.lessonId)
  assert(lesson, 'Lesson record missing in sim mode')
  assert(lesson.status === 'ready', 'Lesson status should be ready in sim mode')

  const runTypes = harness.mutationCalls
    .filter((call) => call.name === 'lessons:createGenerationRun')
    .map((call) => String(call.args.runType))

  for (const requiredType of [
    'profile',
    'plan',
    'topic',
    'tts',
    'timing',
    'scene',
    'qa',
  ]) {
    assert(
      runTypes.includes(requiredType),
      `Missing stage run type in sim mode: ${requiredType}`,
    )
  }

  const latestProfileSaveCall = harness.mutationCalls
    .filter((call) => call.name === 'lessons:saveCourseProfile')
    .at(-1)
  assert(latestProfileSaveCall, 'Expected saveCourseProfile call in sim mode')
  assert(
    typeof latestProfileSaveCall.args.courseSummary === 'string' &&
      latestProfileSaveCall.args.courseSummary.length > 20,
    'Expected persisted courseSummary in sim mode',
  )

  console.log('SIM_E2E_OK', {
    lessonId: result.lessonId,
    topics: result.topics.length,
    totalDurationMs: lesson.totalDurationMs ?? 0,
  })
}

async function runLiveMode(): Promise<void> {
  const fixture = parseFixturePath()
  const sourceJson = await readFile(resolve(fixture), 'utf8')

  assert(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    'Missing GOOGLE_GENERATIVE_AI_API_KEY',
  )
  assert(process.env.SARVAM_API_KEY, 'Missing SARVAM_API_KEY')
  assert(process.env.VITE_CONVEX_URL, 'Missing VITE_CONVEX_URL')

  const result = await runLessonPipeline({
    sourceJson,
    targetLanguage: 'english',
    voice: process.env.SARVAM_TTS_VOICE ?? 'bulbul:v3',
  })

  assert(result.topics.length > 0, 'Pipeline produced zero topics in live mode')
  assert(
    result.topics.every((topic) => topic.status === 'rendered'),
    'All live topics should be rendered',
  )

  const bundle = await fetchLessonBundle(result.lessonId)
  validateSync(bundle)
  assert(
    bundle.lesson.status === 'ready',
    'Lesson should be ready in live mode',
  )

  console.log('LIVE_E2E_OK', {
    lessonId: result.lessonId,
    lessonStatus: bundle.lesson.status,
    topicCount: bundle.topics.length,
    totalDurationMs: bundle.lesson.totalDurationMs ?? 0,
  })
}

async function main() {
  const mode = parseMode()
  if (mode === 'live') {
    await runLiveMode()
    return
  }
  await runSimMode()
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('PIPELINE_E2E_FAILED', message)
  process.exitCode = 1
})

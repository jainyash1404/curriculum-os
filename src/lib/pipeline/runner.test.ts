import { describe, expect, it, vi } from 'vitest'
import { runLessonPipeline } from './runner'
import type { PipelineDeps } from './runner'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock('@/lib/ai/provider', () => ({
  getPlannerModel: () => 'mock-planner-model',
  getTopicModel: () => 'mock-topic-model',
  getTranslatorModel: () => 'mock-translator-model',
}))

vi.mock('@/lib/convex/client', () => ({
  createConvexClient: () => {
    throw new Error('createConvexClient should not be used in this test')
  },
  makeActionReference: (name: string) => name,
  makeMutationReference: (name: string) => name,
  makeQueryReference: (name: string) => name,
}))

type MutationCall = {
  name: string
  args: Record<string, unknown>
}

type LessonRecord = {
  lessonId: string
  status: string
  totalDurationMs?: number
}

type TopicRecord = {
  topicId: string
  lessonId: string
  title: string
  status: string
}

function createTestHarness(
  overrides?: Partial<PipelineDeps> & {
    synthesizeAudioImpl?: PipelineDeps['synthesizeAudio']
  },
) {
  let lessonCounter = 0
  let topicCounter = 0
  let runCounter = 0

  const mutationCalls: Array<MutationCall> = []
  const lessons = new Map<string, LessonRecord>()
  const topics = new Map<string, TopicRecord>()

  const callMutation = ((name, args) => {
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
        const record = lessons.get(lessonId)
        if (record) {
          record.status = String(args.status)
          if (typeof args.totalDurationMs === 'number') {
            record.totalDurationMs = args.totalDurationMs
          }
        }
        return Promise.resolve({ ok: true })
      }
      case 'lessons:updateLessonMetadata':
      case 'lessons:saveCourseProfile':
        return Promise.resolve({ ok: true })
      case 'lessons:createTopic': {
        topicCounter += 1
        const topicId = `topic-${topicCounter}`
        topics.set(topicId, {
          topicId,
          lessonId: String(args.lessonId),
          title: String(args.title),
          status: 'pending',
        })
        return Promise.resolve({ topicId })
      }
      case 'lessons:setTopicStatus': {
        const topicId = String(args.topicId)
        const topic = topics.get(topicId)
        if (topic) {
          topic.status = String(args.status)
        }
        return Promise.resolve({ ok: true })
      }
      case 'lessons:createGenerationRun': {
        runCounter += 1
        return Promise.resolve({ runId: `run-${runCounter}` })
      }
      case 'lessons:updateGenerationRun':
      case 'lessons:saveTopicScript':
      case 'lessons:saveAudioAsset':
      case 'lessons:saveTimingTrack':
      case 'lessons:saveScenePlans':
        return Promise.resolve({ ok: true })
      default:
        return Promise.reject(
          new Error(`Unhandled mutation in test harness: ${name}`),
        )
    }
  }) as PipelineDeps['callMutation']

  const callAction = (() =>
    Promise.resolve({ ok: true })) as PipelineDeps['callAction']
  const callQuery = (() => Promise.resolve(null)) as PipelineDeps['callQuery']

  const deps: Partial<PipelineDeps> = {
    callMutation,
    callAction,
    callQuery,
    planTopics: ({ title }) =>
      Promise.resolve({
        lessonTitle: `${title} Planned`,
        objective: 'Teach clearly',
        topics: [
          { title: 'Topic 1', brief: 'First topic' },
          { title: 'Topic 2', brief: 'Second topic' },
        ],
      }),
    generateTopicScript: ({ topic }) =>
      Promise.resolve(
        `${topic.title} ` +
          'narration '.repeat(120) +
          'with enough words for robust timing coverage.',
      ),
    profileLearner: () =>
      Promise.resolve({
        profileSummary:
          'Intermediate learner profile with practical preference for examples.',
        learnerLevel: 'intermediate',
        confidenceScore: 0.82,
        diagnosticAccuracy: 0.64,
        answeredCount: 10,
        strengths: ['Core concepts'],
        gaps: ['Edge cases'],
        generatorNotes: ['Use examples-first pacing and frequent recaps.'],
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
            '<!doctype html><html><body><div>Scene A</div></body></html>',
          animationSpec: '{"mode":"test-scene"}',
          interactionSpec: 'toggle',
        },
        {
          sceneId: 'scene-2',
          startMs: Math.max(1000, Math.floor(durationMs / 2)),
          endMs: durationMs,
          htmlSpec:
            '<!doctype html><html><body><div>Scene B</div></body></html>',
          animationSpec: '{"mode":"test-scene"}',
          interactionSpec: 'slider',
        },
      ]),
    synthesizeAudio:
      overrides?.synthesizeAudioImpl ??
      (({ text }) =>
        Promise.resolve({
          voiceModel: 'bulbul:v3',
          mimeType: 'audio/mpeg',
          durationMs: Math.max(
            3000,
            Math.round(text.split(/\s+/).length * 250),
          ),
          storageId: 'storage-1',
          storagePath: 'https://storage.example/audio.mp3',
        })),
    sleep: () => Promise.resolve(),
    maxRetries: 1,
    retryBaseDelayMs: 10,
    topicConcurrency: 2,
  }

  return {
    deps: {
      ...deps,
      ...overrides,
      synthesizeAudio: overrides?.synthesizeAudioImpl ?? deps.synthesizeAudio,
    } as Partial<PipelineDeps>,
    mutationCalls,
    lessons,
    topics,
  }
}

function makeSourceJson(): string {
  return JSON.stringify({
    title: 'Sample Lesson',
    description: 'Pipeline test',
    content: {
      script:
        'Intro paragraph with enough words to split. '.repeat(70) +
        '\n\nSecond paragraph with enough words to split. '.repeat(70),
      animation_markup: '',
      transcript_text: '',
      audio_url: '',
    },
  })
}

function makeSourceJsonWithAnimationMarkup(): string {
  return JSON.stringify({
    title: 'Animation Heavy Lesson',
    description: 'Includes provided interactive blocks',
    content: {
      script:
        'Scene one words '.repeat(45) +
        '\n\n' +
        'Scene two words '.repeat(45) +
        '\n\n' +
        'Scene three words '.repeat(45),
      animation_markup: `
<script_animation>
  <script_part>intro block</script_part>
  <animation_html_code><div id="s1">Scene 1</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>concept block with more text</script_part>
  <animation_html_code><div id="s2">Scene 2</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>comparison block for interaction</script_part>
  <animation_html_code><div id="s3">Scene 3</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>wrap up block with recap details</script_part>
  <animation_html_code><div id="s4">Scene 4</div></animation_html_code>
</script_animation>`,
      transcript_text: '',
      audio_url: '',
    },
  })
}

describe('runLessonPipeline', () => {
  it('completes a full run with rendered topics and ready lesson status', async () => {
    const harness = createTestHarness()

    const result = await runLessonPipeline(
      {
        sourceJson: makeSourceJson(),
        targetLanguage: 'english',
        voice: 'bulbul:v3',
      },
      harness.deps,
    )

    expect(result.title).toContain('Planned')
    expect(result.topics).toHaveLength(2)
    expect(result.topics.every((topic) => topic.status === 'rendered')).toBe(
      true,
    )

    const lesson = harness.lessons.get(result.lessonId)
    expect(lesson?.status).toBe('ready')
    expect((lesson?.totalDurationMs ?? 0) > 0).toBe(true)

    const stageRuns = harness.mutationCalls
      .filter((call) => call.name === 'lessons:createGenerationRun')
      .map((call) => String(call.args.runType))

    expect(stageRuns.filter((type) => type === 'profile')).toHaveLength(1)
    expect(stageRuns.filter((type) => type === 'plan')).toHaveLength(1)
    expect(stageRuns.filter((type) => type === 'topic')).toHaveLength(2)
    expect(stageRuns.filter((type) => type === 'tts')).toHaveLength(2)
    expect(stageRuns.filter((type) => type === 'timing')).toHaveLength(2)
    expect(stageRuns.filter((type) => type === 'scene')).toHaveLength(2)
    expect(stageRuns.filter((type) => type === 'qa')).toHaveLength(2)

    const profileSaveCall = harness.mutationCalls
      .filter((call) => call.name === 'lessons:saveCourseProfile')
      .at(-1)
    expect(typeof profileSaveCall?.args.courseSummary).toBe('string')
    expect(String(profileSaveCall?.args.courseSummary).length).toBeGreaterThan(
      20,
    )
  })

  it('retries transient tts failure and eventually succeeds', async () => {
    let ttsCalls = 0
    const sleepSpy = vi.fn(() => Promise.resolve())

    const harness = createTestHarness({
      topicConcurrency: 1,
      maxRetries: 1,
      retryBaseDelayMs: 5,
      sleep: sleepSpy,
      synthesizeAudioImpl: ({ text }) => {
        ttsCalls += 1
        if (ttsCalls === 1) {
          throw new Error('503 service unavailable')
        }
        return Promise.resolve({
          voiceModel: 'bulbul:v3',
          mimeType: 'audio/mpeg',
          durationMs: Math.max(3000, text.split(/\s+/).length * 240),
          storageId: 'storage-2',
          storagePath: 'https://storage.example/audio-2.mp3',
        })
      },
    })

    const result = await runLessonPipeline(
      {
        sourceJson: makeSourceJson(),
        targetLanguage: 'english',
      },
      harness.deps,
    )

    expect(ttsCalls).toBeGreaterThanOrEqual(3)
    expect(sleepSpy).toHaveBeenCalled()
    expect(result.topics.every((topic) => topic.status === 'rendered')).toBe(
      true,
    )
    expect(harness.lessons.get(result.lessonId)?.status).toBe('ready')
  })

  it('keeps partial outputs and marks lesson failed when one topic cannot be synthesized', async () => {
    const synthesizeCounts = new Map<string, number>()

    const harness = createTestHarness({
      maxRetries: 1,
      topicConcurrency: 1,
      generateTopicScript: ({ topic }) => {
        const marker = topic.title === 'Topic 1' ? 'FAIL_TARGET' : 'OK_TARGET'
        return Promise.resolve(`${marker} ` + 'narration '.repeat(120))
      },
      synthesizeAudioImpl: ({ text }) => {
        const key = text.includes('FAIL_TARGET') ? 'fail' : 'ok'
        synthesizeCounts.set(key, (synthesizeCounts.get(key) ?? 0) + 1)

        if (key === 'fail') {
          throw new Error('503 provider error')
        }

        return Promise.resolve({
          voiceModel: 'bulbul:v3',
          mimeType: 'audio/mpeg',
          durationMs: 4200,
          storageId: 'storage-ok',
          storagePath: 'https://storage.example/audio-ok.mp3',
        })
      },
    })

    const result = await runLessonPipeline(
      {
        sourceJson: makeSourceJson(),
        targetLanguage: 'english',
      },
      harness.deps,
    )

    const statuses = result.topics.map((topic) => topic.status)
    expect(statuses).toContain('failed')
    expect(statuses).toContain('rendered')
    expect(harness.lessons.get(result.lessonId)?.status).toBe('failed')
    expect(synthesizeCounts.get('fail')).toBe(2)
  })

  it('uses translated script before tts for non-english runs', async () => {
    let translatedTextSeenByTts = ''

    const harness = createTestHarness({
      planTopics: ({ title }) =>
        Promise.resolve({
          lessonTitle: title,
          objective: 'Translate objective',
          topics: [{ title: 'Single Topic', brief: 'One topic only' }],
        }),
      translateScript: ({ script, targetLanguage }) =>
        Promise.resolve({
          finalScript: `[${targetLanguage}] ${script}`,
          translatedFrom: 'english',
        }),
      synthesizeAudioImpl: ({ text }) => {
        translatedTextSeenByTts = text
        return Promise.resolve({
          voiceModel: 'bulbul:v3',
          mimeType: 'audio/mpeg',
          durationMs: 5000,
          storageId: 'storage-tr',
          storagePath: 'https://storage.example/audio-tr.mp3',
        })
      },
    })

    const result = await runLessonPipeline(
      {
        sourceJson: makeSourceJson(),
        targetLanguage: 'hindi',
      },
      harness.deps,
    )

    expect(result.language).toBe('hindi')
    expect(translatedTextSeenByTts.startsWith('[hindi]')).toBe(true)

    const scriptSaveCall = harness.mutationCalls.find(
      (call) => call.name === 'lessons:saveTopicScript',
    )
    expect(scriptSaveCall?.args.language).toBe('hindi')
    expect(scriptSaveCall?.args.translatedFrom).toBe('english')
  })

  it('reuses provided animation markup scenes across multiple planned topics', async () => {
    const harness = createTestHarness()

    const result = await runLessonPipeline(
      {
        sourceJson: makeSourceJsonWithAnimationMarkup(),
        targetLanguage: 'english',
      },
      harness.deps,
    )

    expect(result.topics).toHaveLength(2)

    const sceneSaveCalls = harness.mutationCalls.filter(
      (call) => call.name === 'lessons:saveScenePlans',
    )
    expect(sceneSaveCalls).toHaveLength(2)

    const allScenes = sceneSaveCalls.flatMap((call) => {
      const scenes = call.args.scenes
      return Array.isArray(scenes) ? scenes : []
    })

    expect(allScenes.length).toBeGreaterThanOrEqual(4)
    expect(
      allScenes.some(
        (scene) =>
          typeof scene === 'object' &&
          scene !== null &&
          'htmlSpec' in scene &&
          typeof scene.htmlSpec === 'string' &&
          scene.htmlSpec.includes('id="s1"'),
      ),
    ).toBe(true)
    expect(
      allScenes.some(
        (scene) =>
          typeof scene === 'object' &&
          scene !== null &&
          'htmlSpec' in scene &&
          typeof scene.htmlSpec === 'string' &&
          scene.htmlSpec.includes('id="s4"'),
      ),
    ).toBe(true)
  })
})

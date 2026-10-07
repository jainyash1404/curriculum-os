import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import {
  alignAnimationBlocksToScenes,
  estimateCuesFromScript,
  getDurationFromCues,
  isEnglish,
  normalizeLanguage,
  parseScriptAnimationBlocks,
  parseSourceTopicJson,
  parseTranscriptCues,
  partitionAnimationBlocks,
} from './source'
import { synthesizeWithSarvam } from './sarvam'
import { buildCourseProfile } from './agents'
import type { ScriptAnimationBlock } from './source'
import type {
  CourseProfile,
  DiagnosticAnswerInput,
  LearningPreferenceSnapshot,
  LessonBundle,
  PipelineRunInput,
  PipelineRunResult,
  PlannedTopic,
  ScenePlanInput,
  TimingCue,
} from './types'
import {
  createConvexClient,
  makeActionReference,
  makeMutationReference,
  makeQueryReference,
} from '@/lib/convex/client'
import {
  getPlannerModel,
  getSceneModel,
  getScriptModel,
  getTranslatorModel,
} from '@/lib/ai/provider'

const plannerSchema = z.object({
  lessonTitle: z.string().min(1),
  objective: z.string().min(1),
  topics: z
    .array(
      z.object({
        title: z.string().min(1),
        brief: z.string().min(1),
        expectedDurationMs: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(10),
})

const scriptSchema = z.object({
  script: z.string().min(80),
})

const translationSchema = z.object({
  translatedScript: z.string().min(20),
})

const sceneHtmlSchema = z.object({
  scenes: z
    .array(
      z.object({
        sceneId: z.string().min(1),
        label: z.string().min(2).max(60),
        htmlSpec: z.string().min(200),
        animationSpec: z.string().min(3).max(300).optional(),
        interactionSpec: z.string().min(3).max(300).optional(),
      }),
    )
    .min(2)
    .max(6),
})

type ConvexDocId = string

type LessonStatus = 'draft' | 'planning' | 'generating' | 'ready' | 'failed'
type TopicStatus =
  | 'pending'
  | 'scripted'
  | 'voiced'
  | 'timed'
  | 'rendered'
  | 'failed'
type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed'
type RunType = 'profile' | 'plan' | 'topic' | 'tts' | 'timing' | 'scene' | 'qa'

type AudioSynthesisResult = {
  voiceModel: string
  mimeType: string
  sampleRate?: number
  durationMs: number
  storageId?: string
  storagePath?: string
  externalUrl?: string
}

type PlanTopicsFn = (args: {
  title: string
  description?: string
  script?: string
  profileContext?: string
}) => Promise<{
  lessonTitle: string
  objective: string
  topics: Array<PlannedTopic>
}>

type GenerateTopicScriptFn = (args: {
  lessonTitle: string
  objective: string
  topic: PlannedTopic
  seedScript?: string
  profileContext?: string
}) => Promise<string>

type ProfileLearnerFn = (args: {
  topic: string
  objective?: string
  targetLanguage: string
  diagnosticAnswers: Array<DiagnosticAnswerInput>
  learningPreferences: LearningPreferenceSnapshot
}) => Promise<CourseProfile>

type TranslateScriptFn = (args: {
  script: string
  targetLanguage: string
}) => Promise<{
  finalScript: string
  translatedFrom?: string
}>

type SynthesizeAudioFn = (args: {
  text: string
  language: string
  voice?: string
}) => Promise<AudioSynthesisResult>

type GenerateScenesFn = (args: {
  topicTitle: string
  translatedScript: string
  durationMs: number
  language: string
  profileContext?: string
}) => Promise<Array<ScenePlanInput>>

type CallMutationFn = <TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
) => Promise<TResult>

type CallActionFn = <TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
) => Promise<TResult>

type CallQueryFn = <TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
) => Promise<TResult>

export type PipelineRuntimeConfig = {
  maxRetries?: number
  retryBaseDelayMs?: number
  topicConcurrency?: number
}

export type PipelineDeps = {
  callMutation: CallMutationFn
  callAction: CallActionFn
  callQuery: CallQueryFn
  planTopics: PlanTopicsFn
  generateTopicScript: GenerateTopicScriptFn
  generateScenes: GenerateScenesFn
  profileLearner: ProfileLearnerFn
  translateScript: TranslateScriptFn
  synthesizeAudio: SynthesizeAudioFn
  sleep: (ms: number) => Promise<void>
} & PipelineRuntimeConfig

async function callMutation<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  const client = createConvexClient()
  return client.mutation(makeMutationReference(name), args) as Promise<TResult>
}

async function callAction<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  const client = createConvexClient()
  return client.action(makeActionReference(name), args) as Promise<TResult>
}

async function callQuery<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  const client = createConvexClient()
  return client.query(makeQueryReference(name), args) as Promise<TResult>
}

function splitSourceScriptByTopics(
  script: string,
  topics: Array<PlannedTopic>,
): Array<string> {
  const cleaned = script.trim()
  if (!cleaned) {
    return topics.map(() => '')
  }

  if (topics.length === 1) {
    return [cleaned]
  }

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paragraphs.length <= 1) {
    const words = cleaned.split(/\s+/).filter(Boolean)
    const chunk = Math.ceil(words.length / topics.length)
    return topics.map((_, index) =>
      words
        .slice(index * chunk, (index + 1) * chunk)
        .join(' ')
        .trim(),
    )
  }

  const chunk = Math.ceil(paragraphs.length / topics.length)
  return topics.map((_, index) =>
    paragraphs
      .slice(index * chunk, (index + 1) * chunk)
      .join('\n\n')
      .trim(),
  )
}

async function planTopicsWithModel({
  title,
  description,
  script,
  profileContext,
}: {
  title: string
  description?: string
  script?: string
  profileContext?: string
}): Promise<{
  lessonTitle: string
  objective: string
  topics: Array<PlannedTopic>
}> {
  const fallback = {
    lessonTitle: title,
    objective:
      description ??
      'Build conceptual understanding with interactive examples.',
    topics: [
      {
        title,
        brief: description ?? 'Introductory topic',
        expectedDurationMs: 180000,
      },
    ],
  }

  try {
    const { object } = await generateObject({
      model: getPlannerModel(),
      schema: plannerSchema,
      prompt: `You are PlannerAgent for an interactive lesson pipeline.
Create a lesson plan with 1 to 10 topic sections, based on what covers the material best.
Keep duration realistic for short narrated scenes.
Bias toward scene-friendly structure that can be visualized with interactive web UI.
Each topic should represent one coherent interaction arc.
Design with a visualization-first mindset: narration explains what users see.

Title: ${title}
Description: ${description ?? 'N/A'}
Source script excerpt: ${(script ?? '').slice(0, 3500)}
Learner profile context: ${profileContext ?? 'N/A'}
`,
    })

    return {
      lessonTitle: object.lessonTitle,
      objective: object.objective,
      topics: object.topics.map((topic) => ({
        title: topic.title,
        brief: topic.brief,
        expectedDurationMs: topic.expectedDurationMs,
      })),
    }
  } catch {
    return fallback
  }
}

async function generateTopicScriptWithModel({
  lessonTitle,
  objective,
  topic,
  seedScript,
  profileContext,
}: {
  lessonTitle: string
  objective: string
  topic: PlannedTopic
  seedScript?: string
  profileContext?: string
}): Promise<string> {
  if (seedScript && seedScript.trim().length >= 80) {
    return seedScript.trim()
  }

  const { object } = await generateObject({
    model: getScriptModel(),
    schema: scriptSchema,
    prompt: `You are TopicAgent.
Write a narrator-ready script in English for one interactive lesson segment.

Lesson: ${lessonTitle}
Objective: ${objective}
Topic: ${topic.title}
Brief: ${topic.brief ?? 'N/A'}
Learner profile context: ${profileContext ?? 'N/A'}

Constraints:
- 180 to 320 words
- clear spoken style
- no markdown
- include short pauses in plain text only when natural
- use 3 to 6 short paragraphs, each paragraph focused on one visual beat
- include concrete nouns/actions that can be shown via interactive HTML controls
- narration must explain visuals, not read text from slides`,
  })

  return object.script
}

function sanitizeSceneLabel(label: string): string {
  return label
    .replace(/[<>&"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveSceneCount(durationMs: number): number {
  const estimate = Math.round(durationMs / 16000)
  return Math.max(2, Math.min(6, estimate || 2))
}

function ensureFullHtmlDocument(html: string): string {
  const trimmed = html.trim()
  if (trimmed.toLowerCase().includes('<html')) {
    return trimmed
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
${trimmed}
</body>
</html>`
}

function buildSceneTimeline(
  sceneCount: number,
  durationMs: number,
): Array<{ startMs: number; endMs: number }> {
  const count = Math.max(1, sceneCount)
  const safeDuration = Math.max(1200, durationMs)
  const chunk = Math.floor(safeDuration / count)

  return Array.from({ length: count }, (_, index) => {
    const startMs = index * chunk
    const endMs = index === count - 1 ? safeDuration : startMs + chunk
    return { startMs, endMs }
  })
}

function buildThemeIdeas(topicTitle: string): Array<string> {
  const lower = topicTitle.toLowerCase()
  if (
    lower.includes('network') ||
    lower.includes('tls') ||
    lower.includes('security')
  ) {
    return [
      'Animated packet-flow map that auto-plays during narration, then lets user drag nodes and trigger handshake steps',
      'Shield-and-key choreography that auto-animates encryption phases, then reveals a sandbox to test different key sizes',
      'Split-screen secure channel animation that auto-transitions, then offers toggle switches to break/fix the channel',
    ]
  }
  if (
    lower.includes('math') ||
    lower.includes('data') ||
    lower.includes('stats')
  ) {
    return [
      'Auto-drawing chart that plots data during narration, then reveals draggable sliders to change parameters',
      'Node graph that auto-morphs during narration, then allows drag-rearrange and assumption toggles',
      'Signal dashboard that auto-fills during narration, then lets user scrub thresholds and compare distributions',
    ]
  }
  return [
    'Concept map that auto-draws connections during narration, then lets user drag-rearrange and explore relationships',
    'Process flow that auto-animates state transitions, then offers toggles and branch selectors to explore what-ifs',
    'Simulation panel that auto-runs during narration, then reveals direct manipulation controls for experimentation',
  ]
}

async function generateSceneHtmlWithModel(args: {
  topicTitle: string
  translatedScript: string
  durationMs: number
  language: string
  profileContext?: string
}): Promise<Array<ScenePlanInput>> {
  const requestedCount = deriveSceneCount(args.durationMs)
  const timeline = buildSceneTimeline(requestedCount, args.durationMs)
  const themeIdeas = buildThemeIdeas(args.topicTitle)

  const { object } = await generateObject({
    model: getSceneModel(),
    schema: sceneHtmlSchema,
    prompt: `You are SceneAgent — a visualization designer for narrated educational lessons.
Each scene you produce is embedded in an iframe (16:9 area) alongside synced audio narration.

═══ TWO-PHASE SCENE MODEL ═══

Every scene MUST operate in two distinct phases controlled by postMessage from the parent player:

PHASE 1 — "narrate" (auto-animation while voice plays)
• Scene starts in this phase by default.
• Run a self-playing animation/visualization that illustrates the narrated concept.
• NO interactive controls visible — the learner watches and listens.
• Animation should be timed to roughly fill the scene's duration.
• Examples: diagram drawing itself, data flowing through a pipeline, chart bars rising, nodes connecting, process steps appearing sequentially.

PHASE 2 — "interact" (exploration after voice ends)
• Triggered when the player sends: window.postMessage({ type: 'scene-phase', phase: 'interact' }, '*')
• Freeze or complete the narration animation.
• Reveal interactive controls so the learner can explore the concept just explained.
• Interaction types: drag-to-rearrange, sliders to tweak parameters, toggles to show/hide layers, click-to-expand details, scrub through states, hover-to-reveal annotations.
• Must include at least ONE meaningful interaction per scene — not decorative buttons.
• Show a subtle visual cue (e.g. a brief pulse or label) indicating the scene is now interactive.

═══ postMessage LISTENER (REQUIRED IN EVERY SCENE) ═══

Include this exact listener pattern in every scene's <script>:

  let currentPhase = 'narrate';
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'scene-phase') {
      currentPhase = e.data.phase;
      if (currentPhase === 'interact') {
        // Stop narration animations, reveal interactive controls
        enterInteractMode();
      } else {
        // Resume/restart narration animation, hide interactive controls
        enterNarrateMode();
      }
    }
  });

The functions enterInteractMode() and enterNarrateMode() are yours to implement per scene.

═══ CONTEXT ═══

Topic: ${args.topicTitle}
Language: ${args.language}
Duration: ${args.durationMs}ms
Desired scene count: ${requestedCount}
Learner profile: ${args.profileContext ?? 'N/A'}
Theme direction (pick one): ${themeIdeas.join(' | ')}

Script (this is what the audio narrates):
${args.translatedScript}

═══ RULES ═══

1. Return exactly ${requestedCount} scenes. Each must have: sceneId, label, htmlSpec.
2. htmlSpec must be a complete HTML document (<!DOCTYPE html> + <html> + <head> + <body>) — fully self-contained.
3. Use only vanilla HTML/CSS/JS (no external libraries, no CDN links, no fetch calls, no iframes within the scene).
4. Maintain strict 16:9 visual composition.
5. Background: predominantly white/cream (#fcfbf9 or #ffffff). Use accent colors (#4338ca indigo, #059669 emerald, #dc2626 red) for objects/motion, never dark page fills.
6. Narrate phase: rich automated animation — NOT static slides. Elements should move, draw, grow, morph, or transition.
7. Interact phase: at least one direct-manipulation control (slider, drag handle, toggle, clickable region). The control must meaningfully change the visualization.
8. Minimal text on screen (max 10 words visible at once). Labels/annotations only — no paragraphs.
9. Avoid generic AI visual tropes: no pulsing blobs/orbs, no breathing glow loops, no random gradient fog, no particle systems without purpose.
10. Clean, high-contrast, concept-driven visuals. Every element should relate to the topic.
11. Do NOT include markdown fences in the output.`,
  })

  return object.scenes.slice(0, requestedCount).map((scene, index) => {
    const range = timeline[index] ?? { startMs: 0, endMs: args.durationMs }
    const label = sanitizeSceneLabel(scene.label) || `Scene ${index + 1}`

    return {
      sceneId: scene.sceneId.trim() || `scene-${index + 1}`,
      startMs: range.startMs,
      endMs: range.endMs,
      htmlSpec: ensureFullHtmlDocument(scene.htmlSpec),
      animationSpec:
        scene.animationSpec?.trim() ||
        JSON.stringify({
          mode: 'agent-full-html',
          label,
          frame: '16:9',
        }),
      interactionSpec: scene.interactionSpec?.trim() || `Interactive ${label}`,
    }
  })
}

async function translateScriptWithModel({
  script,
  targetLanguage,
}: {
  script: string
  targetLanguage: string
}): Promise<{
  finalScript: string
  translatedFrom?: string
}> {
  if (isEnglish(targetLanguage)) {
    return { finalScript: script }
  }

  const { object } = await generateObject({
    model: getTranslatorModel(),
    schema: translationSchema,
    prompt: `Translate this script into ${targetLanguage}. Keep narration tone and timing-friendly phrasing.
Preserve paragraph boundaries so scene segmentation stays stable.
Output only translated text.

${script}`,
  })

  return {
    finalScript: object.translatedScript,
    translatedFrom: 'english',
  }
}

function cuesToDuration(cues: Array<TimingCue>, fallbackMs: number): number {
  const cueDuration = getDurationFromCues(cues)
  return cueDuration > 0 ? cueDuration : fallbackMs
}

function scaleCuesToDuration(
  cues: Array<TimingCue>,
  targetDurationMs: number,
): Array<TimingCue> {
  if (cues.length === 0 || targetDurationMs <= 0) {
    return cues
  }
  const current = getDurationFromCues(cues)
  if (current <= 0) {
    return cues
  }
  const ratio = targetDurationMs / current
  if (Math.abs(1 - ratio) < 0.1) {
    return cues
  }
  return cues.map((cue) => ({
    ...cue,
    startMs: Math.round(cue.startMs * ratio),
    endMs: Math.round(cue.endMs * ratio),
  }))
}

async function storeAudioInConvex(
  actionCaller: CallActionFn,
  base64Audio: string,
  mimeType: string,
): Promise<{
  storageId: string
  storageUrl: string | null
  bytesLength: number
}> {
  return actionCaller<
    { base64: string; mimeType: string },
    { storageId: string; storageUrl: string | null; bytesLength: number }
  >('lessons:storeAudioFromBase64', {
    base64: base64Audio,
    mimeType,
  })
}

async function downloadUrlAsBase64(url: string): Promise<string | null> {
  const response = await fetch(url)
  if (!response.ok) {
    return null
  }
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer).toString('base64')
}

async function synthesizeAndStoreAudioWithSarvam(
  actionCaller: CallActionFn,
  {
    text,
    language,
    voice,
  }: {
    text: string
    language: string
    voice?: string
  },
): Promise<AudioSynthesisResult> {
  const tts = await synthesizeWithSarvam({ text, language, voice })

  let base64Audio = tts.base64Audio
  if (!base64Audio && tts.externalAudioUrl) {
    const downloaded = await downloadUrlAsBase64(tts.externalAudioUrl)
    if (downloaded) {
      base64Audio = downloaded
    }
  }

  let storageId: string | undefined
  let storagePath: string | undefined
  if (base64Audio) {
    const stored = await storeAudioInConvex(
      actionCaller,
      base64Audio,
      tts.mimeType,
    )
    storageId = stored.storageId
    storagePath = stored.storageUrl ?? undefined
  }

  const estimatedDurationMs =
    tts.durationMs ??
    Math.max(
      1200,
      Math.round((text.split(/\s+/).filter(Boolean).length / 2.6) * 1000),
    )

  return {
    voiceModel: tts.voiceModel,
    mimeType: tts.mimeType,
    sampleRate: tts.sampleRate,
    durationMs: estimatedDurationMs,
    storageId,
    storagePath,
    externalUrl: tts.externalAudioUrl,
  }
}

function createDefaultDeps(): PipelineDeps {
  return {
    callMutation,
    callAction,
    callQuery,
    planTopics: planTopicsWithModel,
    generateTopicScript: generateTopicScriptWithModel,
    generateScenes: generateSceneHtmlWithModel,
    profileLearner: buildCourseProfile,
    translateScript: translateScriptWithModel,
    synthesizeAudio: async ({ text, language, voice }) =>
      synthesizeAndStoreAudioWithSarvam(callAction, {
        text,
        language,
        voice,
      }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxRetries: 2,
    retryBaseDelayMs: 350,
    topicConcurrency: 2,
  }
}

function mergeDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return {
    ...createDefaultDeps(),
    ...overrides,
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Unknown error'
}

function getRetryLimit(deps: PipelineDeps): number {
  return Math.max(0, deps.maxRetries ?? 0)
}

function getRetryBaseDelayMs(deps: PipelineDeps): number {
  return Math.max(80, deps.retryBaseDelayMs ?? 300)
}

function getTopicConcurrency(deps: PipelineDeps): number {
  return Math.max(1, deps.topicConcurrency ?? 2)
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('tempor') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('503') ||
    message.includes('502')
  )
}

async function withRetries<T>(
  deps: PipelineDeps,
  operation: () => Promise<T>,
): Promise<T> {
  const retryLimit = getRetryLimit(deps)
  const retryBaseDelayMs = getRetryBaseDelayMs(deps)

  for (let attempt = 0; ; ) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= retryLimit || !isRetryableError(error)) {
        throw error
      }
      const waitMs = retryBaseDelayMs * 2 ** attempt
      await deps.sleep(waitMs)
      attempt += 1
    }
  }
}

async function runWithConcurrency<T, TResult>(
  items: Array<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>,
): Promise<Array<TResult>> {
  if (items.length === 0) {
    return []
  }

  const results: Array<TResult> = []
  let cursor = 0

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        return
      }
      const item = items[index]
      results[index] = await worker(item, index)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  )
  await Promise.all(workers)
  return results
}

function buildBaseCuesForTopic({
  translatedScript,
  sourceCues,
  topicCount,
}: {
  translatedScript: string
  sourceCues: Array<TimingCue>
  topicCount: number
}): Array<TimingCue> {
  if (sourceCues.length > 0 && topicCount === 1) {
    return sourceCues
  }
  return estimateCuesFromScript(translatedScript)
}

async function buildScenesForTopic({
  generateScenes,
  topicTitle,
  translatedScript,
  durationMs,
  sourceAnimationBlocksForTopic,
  language,
  profileContext,
}: {
  generateScenes: GenerateScenesFn
  topicTitle: string
  translatedScript: string
  durationMs: number
  sourceAnimationBlocksForTopic: Array<ScriptAnimationBlock>
  language: string
  profileContext?: string
}): Promise<Array<ScenePlanInput>> {
  const sourceScenes =
    sourceAnimationBlocksForTopic.length > 0
      ? alignAnimationBlocksToScenes(sourceAnimationBlocksForTopic, durationMs)
      : []

  if (sourceScenes.length > 0) {
    return sourceScenes.map((scene) => ({
      ...scene,
      animationSpec: JSON.stringify({
        mode: 'source-provided',
        frame: '16:9-recommended',
      }),
    }))
  }

  const modelScenes = await generateScenes({
    topicTitle,
    translatedScript,
    durationMs,
    language,
    profileContext,
  })

  if (modelScenes.length === 0) {
    throw new Error('SceneAgent produced no scenes')
  }

  return modelScenes
}

function ensureSceneCoverage(
  scenes: Array<ScenePlanInput>,
  durationMs: number,
): void {
  if (scenes.length === 0) {
    throw new Error('SceneAgent produced no scenes')
  }

  const first = scenes.at(0)
  const last = scenes.at(-1)
  if (first === undefined || last === undefined) {
    throw new Error('SceneAgent produced invalid scene boundaries')
  }

  const maxDriftMs = 1800
  const trailingDrift = Math.abs(last.endMs - durationMs)
  if (trailingDrift > maxDriftMs) {
    throw new Error(`Scene/audio drift too high: ${trailingDrift}ms`)
  }

  if (first.startMs > maxDriftMs) {
    throw new Error(`Scene start drift too high: ${first.startMs}ms`)
  }
}

function ensureCueCoverage(cues: Array<TimingCue>, durationMs: number): void {
  if (cues.length === 0) {
    throw new Error('TimingAgent produced no cues')
  }

  const lastCue = cues.at(-1)
  if (lastCue === undefined) {
    throw new Error('TimingAgent produced invalid cues')
  }

  const maxDriftMs = 1800
  const drift = Math.abs(lastCue.endMs - durationMs)
  if (drift > maxDriftMs) {
    throw new Error(`Cue/audio drift too high: ${drift}ms`)
  }
}

async function createGenerationRun(
  deps: PipelineDeps,
  args: {
    lessonId: string
    runType: RunType
    status: RunStatus
    agentName: string
    error?: string
  },
): Promise<{ runId: string }> {
  return deps.callMutation<typeof args, { runId: string }>(
    'lessons:createGenerationRun',
    args,
  )
}

async function updateGenerationRun(
  deps: PipelineDeps,
  args: {
    runId: string
    status: RunStatus
    error?: string
  },
): Promise<void> {
  await deps.callMutation<typeof args, { ok: boolean }>(
    'lessons:updateGenerationRun',
    args,
  )
}

async function runStage<T>(
  deps: PipelineDeps,
  args: {
    lessonId: string
    runType: RunType
    agentName: string
    operation: () => Promise<T>
  },
): Promise<T> {
  const stageRun = await createGenerationRun(deps, {
    lessonId: args.lessonId,
    runType: args.runType,
    status: 'running',
    agentName: args.agentName,
  })

  try {
    const value = await args.operation()
    await updateGenerationRun(deps, {
      runId: stageRun.runId,
      status: 'succeeded',
    })
    return value
  } catch (error) {
    await updateGenerationRun(deps, {
      runId: stageRun.runId,
      status: 'failed',
      error: formatErrorMessage(error),
    })
    throw error
  }
}

async function setLessonStatus(
  deps: PipelineDeps,
  args: {
    lessonId: string
    status: LessonStatus
    totalDurationMs?: number
  },
): Promise<void> {
  await deps.callMutation<typeof args, { ok: boolean }>(
    'lessons:setLessonStatus',
    args,
  )
}

async function setTopicStatus(
  deps: PipelineDeps,
  args: {
    topicId: string
    status: TopicStatus
  },
): Promise<void> {
  await deps.callMutation<typeof args, { ok: boolean }>(
    'lessons:setTopicStatus',
    args,
  )
}

function defaultLearningPreferences(): LearningPreferenceSnapshot {
  return {
    pace: ['medium'],
    depth: ['mixed'],
    format: ['mixed'],
    interactivity: ['medium'],
    assessment: ['per topic'],
  }
}

function resolveSourceFromInput(input: PipelineRunInput): {
  title: string
  description?: string
  content: {
    script?: string
    animationMarkup?: string
    transcriptRaw?: unknown
  }
} {
  if (input.sourceJson && input.sourceJson.trim().length > 0) {
    return parseSourceTopicJson(input.sourceJson)
  }

  const topic = input.courseTopic?.trim()
  if (!topic) {
    throw new Error('Provide either sourceJson or courseTopic')
  }

  return {
    title: topic,
    description: input.courseObjective?.trim() || undefined,
    content: {},
  }
}

function buildProfileContext(profile: CourseProfile): string {
  return [
    profile.profileSummary,
    `Learner level: ${profile.learnerLevel}`,
    `Profile confidence: ${(profile.confidenceScore * 100).toFixed(0)}%`,
    `Strengths: ${profile.strengths.join(', ') || 'N/A'}`,
    `Gaps: ${profile.gaps.join(', ') || 'N/A'}`,
    `Generator notes: ${profile.generatorNotes.join(' | ') || 'N/A'}`,
  ].join('\n')
}

function buildCourseSummary(args: {
  topic: string
  objective?: string
  profile: CourseProfile
  plannedTopics: Array<PlannedTopic>
}): string {
  const topicTitles = args.plannedTopics
    .map((plannedTopic) => plannedTopic.title.trim())
    .filter(Boolean)
    .slice(0, 10)

  const objectivePart = args.objective?.trim()
    ? ` Objective: ${args.objective.trim()}.`
    : ''

  const pathwayPart =
    topicTitles.length > 0 ? ` Pathway: ${topicTitles.join(' -> ')}.` : ''

  const guidancePart = args.profile.generatorNotes.at(0)
    ? ` Guidance: ${args.profile.generatorNotes.at(0)}`
    : ''

  return [
    `Course on ${args.topic} for ${args.profile.learnerLevel} learners.`,
    `Confidence ${(args.profile.confidenceScore * 100).toFixed(0)}% and diagnostic accuracy ${(args.profile.diagnosticAccuracy * 100).toFixed(0)}%.`,
    objectivePart,
    pathwayPart,
    guidancePart,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function runLessonPipeline(
  input: PipelineRunInput,
  depsOverride?: Partial<PipelineDeps>,
): Promise<PipelineRunResult> {
  const deps = mergeDeps(depsOverride)
  const source = resolveSourceFromInput(input)
  const language = normalizeLanguage(input.targetLanguage || 'english')
  const sourceScript = source.content.script?.trim()
  const sourceAnimationMarkup = source.content.animationMarkup
  const sourceCues = parseTranscriptCues(source.content.transcriptRaw)
  const sourceAnimationBlocks = parseScriptAnimationBlocks(
    sourceAnimationMarkup ?? '',
  )
  const learningPreferences =
    input.learningPreferences ?? defaultLearningPreferences()
  const diagnosticAnswers = input.diagnosticAnswers ?? []

  const createdLesson = await deps.callMutation<
    {
      title: string
      language: string
      objective?: string
      sourceJsonPath?: string
      userId?: string
    },
    { lessonId: ConvexDocId }
  >('lessons:createLesson', {
    title: source.title,
    language,
    objective: source.description,
    userId: input.userId,
  })

  const lessonId = createdLesson.lessonId

  await setLessonStatus(deps, {
    lessonId,
    status: 'planning',
  })

  let profile: CourseProfile
  let planRun: {
    lessonTitle: string
    objective: string
    topics: Array<PlannedTopic>
  }
  try {
    profile = await runStage(deps, {
      lessonId,
      runType: 'profile',
      agentName: 'ProfilerAgent',
      operation: () =>
        withRetries(deps, () =>
          deps.profileLearner({
            topic: source.title,
            objective: source.description,
            targetLanguage: language,
            diagnosticAnswers,
            learningPreferences,
          }),
        ),
    })

    await deps.callMutation('lessons:saveCourseProfile', {
      lessonId,
      topic: source.title,
      objective: source.description,
      courseSummary: buildCourseSummary({
        topic: source.title,
        objective: source.description,
        profile,
        plannedTopics: [],
      }),
      learnerLevel: profile.learnerLevel,
      confidenceScore: profile.confidenceScore,
      diagnosticAccuracy: profile.diagnosticAccuracy,
      answeredCount: profile.answeredCount,
      profileSummary: profile.profileSummary,
      strengthsJson: JSON.stringify(profile.strengths),
      gapsJson: JSON.stringify(profile.gaps),
      generatorNotesJson: JSON.stringify(profile.generatorNotes),
      preferencesJson: JSON.stringify(learningPreferences),
      diagnosticAnswersJson: JSON.stringify(diagnosticAnswers),
    })

    const profileContext = buildProfileContext(profile)
    planRun = await runStage(deps, {
      lessonId,
      runType: 'plan',
      agentName: 'GeneratorAgent',
      operation: () =>
        withRetries(deps, () =>
          deps.planTopics({
            title: source.title,
            description: source.description,
            script: sourceScript,
            profileContext,
          }),
        ),
    })

    await deps.callMutation('lessons:updateLessonMetadata', {
      lessonId,
      title: planRun.lessonTitle,
      objective: planRun.objective,
    })

    await deps.callMutation('lessons:saveCourseProfile', {
      lessonId,
      topic: source.title,
      objective: source.description,
      courseSummary: buildCourseSummary({
        topic: source.title,
        objective: source.description,
        profile,
        plannedTopics: planRun.topics,
      }),
      learnerLevel: profile.learnerLevel,
      confidenceScore: profile.confidenceScore,
      diagnosticAccuracy: profile.diagnosticAccuracy,
      answeredCount: profile.answeredCount,
      profileSummary: profile.profileSummary,
      strengthsJson: JSON.stringify(profile.strengths),
      gapsJson: JSON.stringify(profile.gaps),
      generatorNotesJson: JSON.stringify(profile.generatorNotes),
      preferencesJson: JSON.stringify(learningPreferences),
      diagnosticAnswersJson: JSON.stringify(diagnosticAnswers),
    })
  } catch (error) {
    await setLessonStatus(deps, {
      lessonId,
      status: 'failed',
    })
    throw error
  }

  const sourceSplits = splitSourceScriptByTopics(
    sourceScript ?? '',
    planRun.topics,
  )
  const sourceBlocksByTopic = partitionAnimationBlocks(
    sourceAnimationBlocks,
    planRun.topics.length,
  )

  await setLessonStatus(deps, {
    lessonId,
    status: 'generating',
  })

  const topicResults = await runWithConcurrency(
    planRun.topics,
    getTopicConcurrency(deps),
    async (topicPlan, index) => {
      const topicRun = await createGenerationRun(deps, {
        lessonId,
        runType: 'topic',
        status: 'running',
        agentName: `TopicAgent-${index + 1}`,
      })

      let topicId: string | null = null

      try {
        const createdTopic = await deps.callMutation<
          {
            lessonId: ConvexDocId
            topicIndex: number
            title: string
            brief?: string
          },
          { topicId: ConvexDocId }
        >('lessons:createTopic', {
          lessonId,
          topicIndex: index,
          title: topicPlan.title,
          brief: topicPlan.brief,
        })

        topicId = createdTopic.topicId
        const currentTopicId = createdTopic.topicId

        const generatedScript = await withRetries(deps, () =>
          deps.generateTopicScript({
            lessonTitle: planRun.lessonTitle,
            objective: planRun.objective,
            topic: topicPlan,
            seedScript: sourceSplits[index],
            profileContext: buildProfileContext(profile),
          }),
        )

        const translated = await withRetries(deps, () =>
          deps.translateScript({
            script: generatedScript,
            targetLanguage: language,
          }),
        )

        await deps.callMutation('lessons:saveTopicScript', {
          lessonId,
          topicId: currentTopicId,
          language,
          transcript: translated.finalScript,
          translatedFrom: translated.translatedFrom,
          narrationStyle: 'explainer',
        })

        await setTopicStatus(deps, {
          topicId: currentTopicId,
          status: 'scripted',
        })

        const audioMeta = await runStage(deps, {
          lessonId,
          runType: 'tts',
          agentName: `VoiceAgent-${index + 1}`,
          operation: () =>
            withRetries(deps, () =>
              deps.synthesizeAudio({
                text: translated.finalScript,
                language,
                voice: input.voice,
              }),
            ),
        })

        await deps.callMutation('lessons:saveAudioAsset', {
          lessonId,
          topicId: currentTopicId,
          provider: 'sarvam',
          voiceModel: audioMeta.voiceModel,
          durationMs: audioMeta.durationMs,
          sampleRate: audioMeta.sampleRate,
          mimeType: audioMeta.mimeType,
          storageId: audioMeta.storageId,
          storagePath: audioMeta.storagePath,
          externalUrl: audioMeta.externalUrl,
        })

        await setTopicStatus(deps, {
          topicId: currentTopicId,
          status: 'voiced',
        })

        const timingResult = await runStage(deps, {
          lessonId,
          runType: 'timing',
          agentName: `TimingAgent-${index + 1}`,
          operation: async () => {
            const baseCues = buildBaseCuesForTopic({
              translatedScript: translated.finalScript,
              sourceCues,
              topicCount: planRun.topics.length,
            })
            const scaledCues = scaleCuesToDuration(
              baseCues,
              audioMeta.durationMs,
            )
            const durationMs = cuesToDuration(scaledCues, audioMeta.durationMs)

            await deps.callMutation('lessons:saveTimingTrack', {
              lessonId,
              topicId: currentTopicId,
              frameRate: 60,
              cues: scaledCues,
            })

            await setTopicStatus(deps, {
              topicId: currentTopicId,
              status: 'timed',
            })

            return {
              cues: scaledCues,
              durationMs,
            }
          },
        })

        const scenes = await runStage(deps, {
          lessonId,
          runType: 'scene',
          agentName: `SceneAgent-${index + 1}`,
          operation: async () => {
            const plannedScenes = await buildScenesForTopic({
              generateScenes: (sceneArgs) =>
                withRetries(deps, () => deps.generateScenes(sceneArgs)),
              topicTitle: topicPlan.title,
              translatedScript: translated.finalScript,
              durationMs: timingResult.durationMs,
              sourceAnimationBlocksForTopic: sourceBlocksByTopic[index] ?? [],
              language,
              profileContext: buildProfileContext(profile),
            })

            await deps.callMutation('lessons:saveScenePlans', {
              lessonId,
              topicId: currentTopicId,
              scenes: plannedScenes,
            })

            return plannedScenes
          },
        })

        await runStage(deps, {
          lessonId,
          runType: 'qa',
          agentName: `SyncQAgent-${index + 1}`,
          operation: async () => {
            ensureCueCoverage(timingResult.cues, timingResult.durationMs)
            ensureSceneCoverage(scenes, timingResult.durationMs)
            await Promise.resolve()
          },
        })

        await setTopicStatus(deps, {
          topicId: currentTopicId,
          status: 'rendered',
        })

        await updateGenerationRun(deps, {
          runId: topicRun.runId,
          status: 'succeeded',
        })

        return {
          topicId: currentTopicId,
          title: topicPlan.title,
          status: 'rendered' as const,
          durationMs: timingResult.durationMs,
          audioUrl: audioMeta.storagePath ?? audioMeta.externalUrl ?? null,
        }
      } catch (error) {
        if (topicId) {
          await setTopicStatus(deps, {
            topicId,
            status: 'failed',
          })
        }

        await updateGenerationRun(deps, {
          runId: topicRun.runId,
          status: 'failed',
          error: formatErrorMessage(error),
        })

        return {
          topicId: topicId ?? `failed-topic-${index + 1}`,
          title: topicPlan.title,
          status: 'failed' as const,
          durationMs: 0,
          audioUrl: null,
        }
      }
    },
  )

  const totalDurationMs = topicResults.reduce(
    (sum, topic) => sum + Math.max(0, topic.durationMs),
    0,
  )
  const hasFailures = topicResults.some((topic) => topic.status === 'failed')

  await setLessonStatus(deps, {
    lessonId,
    status: hasFailures ? 'failed' : 'ready',
    totalDurationMs,
  })

  return {
    lessonId,
    title: planRun.lessonTitle,
    language,
    topics: topicResults,
  }
}

export async function fetchLessonBundle(
  lessonId: string,
  depsOverride?: Partial<Pick<PipelineDeps, 'callQuery'>>,
): Promise<LessonBundle | null> {
  const deps = mergeDeps(depsOverride)
  return deps.callQuery<{ lessonId: string }, LessonBundle | null>(
    'lessons:getLessonBundle',
    {
      lessonId,
    },
  )
}

type LessonSummary = {
  _id: string
  title: string
  language: string
  status: string
}

export async function listLessonSummaries(
  limit = 20,
  userId?: string,
  depsOverride?: Partial<Pick<PipelineDeps, 'callQuery'>>,
): Promise<Array<LessonSummary>> {
  const deps = mergeDeps(depsOverride)
  return deps.callQuery<
    { limit: number; userId?: string },
    Array<LessonSummary>
  >('lessons:listLessons', {
    limit,
    userId,
  })
}

export async function rewriteTopicScriptForLanguage({
  script,
  targetLanguage,
}: {
  script: string
  targetLanguage: string
}): Promise<string> {
  if (isEnglish(targetLanguage)) {
    return script
  }

  const { text } = await generateText({
    model: getTranslatorModel(),
    prompt: `Translate into ${targetLanguage} while preserving meaning and pacing:\n\n${script}`,
  })
  return text
}

export async function deleteLesson(
  lessonId: string,
  requestingUserId?: string,
  depsOverride?: Partial<Pick<PipelineDeps, 'callMutation'>>,
): Promise<{ deleted: boolean }> {
  const deps = mergeDeps(depsOverride)
  return deps.callMutation<
    { lessonId: string; requestingUserId?: string },
    { deleted: boolean }
  >('lessons:deleteLesson', { lessonId, requestingUserId })
}

export type AnalyticsSummary = {
  totalLessons: number
  // Partial (not Record<string, number>) because these come back as plain
  // JSON over the wire — an unknown-status key genuinely can be missing,
  // and this makes that possibility visible to callers instead of lying
  // about it the way a bare Record index signature would.
  statusCounts: Partial<Record<string, number>>
  levelCounts: Partial<Record<string, number>>
  averageDiagnosticAccuracy: number | null
  averageProfileConfidence: number | null
  stageCounts: Partial<
    Record<string, { succeeded: number; failed: number }>
  >
  recentLessons: Array<{
    id: string
    title: string
    status: string
    language: string
    createdAt: number
  }>
}

export async function getAnalyticsSummary(
  depsOverride?: Partial<Pick<PipelineDeps, 'callQuery'>>,
): Promise<AnalyticsSummary> {
  const deps = mergeDeps(depsOverride)
  return deps.callQuery<Record<string, unknown>, AnalyticsSummary>(
    'lessons:getAnalyticsSummary',
    {},
  )
}
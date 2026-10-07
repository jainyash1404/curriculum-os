import type { ParsedSourceTopic, ScenePlanInput, TimingCue } from './types'

export type ScriptAnimationBlock = {
  scriptPart: string
  html: string
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Source JSON must be an object')
  }
  return value as Record<string, unknown>
}

function sanitizeSceneText(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

export function normalizeLanguage(input: string): string {
  const normalized = input.trim().toLowerCase()
  if (['en', 'en-us', 'english'].includes(normalized)) {
    return 'english'
  }
  if (['hi', 'hindi'].includes(normalized)) {
    return 'hindi'
  }
  if (['ta', 'tamil'].includes(normalized)) {
    return 'tamil'
  }
  if (['te', 'telugu'].includes(normalized)) {
    return 'telugu'
  }
  return normalized
}

export function isEnglish(language: string): boolean {
  return normalizeLanguage(language) === 'english'
}

export function parseSourceTopicJson(jsonText: string): ParsedSourceTopic {
  const parsed = JSON.parse(jsonText) as unknown
  const root = ensureObject(parsed)
  const content = ensureObject(root.content)

  return {
    title: String(root.title ?? 'Untitled Lesson'),
    description:
      typeof root.description === 'string' ? root.description : undefined,
    topicUuid:
      typeof root.topic_uuid === 'string' ? root.topic_uuid : undefined,
    content: {
      script: typeof content.script === 'string' ? content.script : undefined,
      animationMarkup:
        typeof content.animation_markup === 'string'
          ? content.animation_markup
          : undefined,
      transcriptRaw: content.transcript_text,
      audioUrl:
        typeof content.audio_url === 'string' ? content.audio_url : undefined,
    },
  }
}

export function parseScriptAnimationBlocks(
  markup: string,
): Array<ScriptAnimationBlock> {
  const blocks: Array<ScriptAnimationBlock> = []
  const regex =
    /<script_animation>[\s\S]*?<script_part>([\s\S]*?)<\/script_part>[\s\S]*?<animation_html_code>([\s\S]*?)<\/animation_html_code>[\s\S]*?<\/script_animation>/g

  for (const match of markup.matchAll(regex)) {
    const scriptPart = sanitizeSceneText(match[1])
    const html = match[2].trim()
    if (scriptPart || html) {
      blocks.push({ scriptPart, html })
    }
  }

  return blocks
}

type TranscriptElement = {
  type?: string
  value?: string
  ts?: number
  end_ts?: number
}

export function parseTranscriptCues(transcriptRaw: unknown): Array<TimingCue> {
  if (transcriptRaw === undefined || transcriptRaw === null) {
    return []
  }

  let transcriptValue: unknown = transcriptRaw
  if (typeof transcriptRaw === 'string') {
    try {
      transcriptValue = JSON.parse(transcriptRaw)
    } catch {
      return []
    }
  }

  const root = ensureObject(transcriptValue)
  const monologues = root.monologues
  if (!Array.isArray(monologues)) {
    return []
  }

  const cues: Array<TimingCue> = []
  for (const monologue of monologues) {
    if (typeof monologue !== 'object' || monologue === null) {
      continue
    }
    const elements = (monologue as { elements?: Array<TranscriptElement> })
      .elements
    if (!Array.isArray(elements)) {
      continue
    }

    for (const element of elements) {
      if (
        element.type !== 'text' ||
        typeof element.value !== 'string' ||
        typeof element.ts !== 'number'
      ) {
        continue
      }
      const startMs = Math.max(0, Math.round(element.ts * 1000))
      const endMs =
        typeof element.end_ts === 'number'
          ? Math.max(startMs + 30, Math.round(element.end_ts * 1000))
          : startMs + 220

      cues.push({
        token: element.value,
        startMs,
        endMs,
      })
    }
  }

  return cues
}

export function estimateCuesFromScript(
  script: string,
  averageMsPerWord = 360,
): Array<TimingCue> {
  const words = script
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  let cursor = 0
  return words.map((word) => {
    const startMs = cursor
    const wordDuration = Math.max(
      180,
      Math.round((word.length / 5) * averageMsPerWord),
    )
    const endMs = startMs + wordDuration
    cursor = endMs
    return {
      token: word,
      startMs,
      endMs,
    }
  })
}

export function getDurationFromCues(cues: Array<TimingCue>): number {
  if (cues.length === 0) {
    return 0
  }
  return cues[cues.length - 1]?.endMs ?? 0
}

export function alignAnimationBlocksToScenes(
  blocks: Array<ScriptAnimationBlock>,
  totalDurationMs: number,
): Array<ScenePlanInput> {
  if (blocks.length === 0) {
    return []
  }

  const safeDuration = Math.max(1200, totalDurationMs)
  const totalWeight = blocks.reduce(
    (sum, block) => sum + Math.max(1, block.scriptPart.length),
    0,
  )
  let cursor = 0

  return blocks.map((block, index) => {
    const weight = Math.max(1, block.scriptPart.length)
    const segment = Math.round((weight / totalWeight) * safeDuration)
    const startMs = cursor
    const endMs =
      index === blocks.length - 1
        ? safeDuration
        : Math.min(safeDuration, startMs + Math.max(800, segment))
    cursor = endMs

    return {
      sceneId: `scene-${index + 1}`,
      startMs,
      endMs,
      htmlSpec: block.html,
      animationSpec: JSON.stringify({
        mode: 'provided-html',
        scriptPart: block.scriptPart,
      }),
    }
  })
}

export function partitionAnimationBlocks(
  blocks: Array<ScriptAnimationBlock>,
  topicCount: number,
): Array<Array<ScriptAnimationBlock>> {
  const count = Math.max(1, topicCount)
  const partitions = Array.from(
    { length: count },
    () => [] as Array<ScriptAnimationBlock>,
  )

  if (blocks.length === 0) {
    return partitions
  }

  if (count === 1) {
    partitions[0] = blocks
    return partitions
  }

  const totalWeight = blocks.reduce(
    (sum, block) => sum + Math.max(1, block.scriptPart.length),
    0,
  )
  const targetWeightPerTopic = totalWeight / count

  let topicIndex = 0
  let topicWeight = 0
  for (const block of blocks) {
    if (
      topicIndex < count - 1 &&
      partitions[topicIndex].length > 0 &&
      topicWeight >= targetWeightPerTopic
    ) {
      topicIndex += 1
      topicWeight = 0
    }

    partitions[topicIndex].push(block)
    topicWeight += Math.max(1, block.scriptPart.length)
  }

  for (let i = 1; i < partitions.length; i += 1) {
    if (partitions[i].length !== 0) {
      continue
    }

    let donorIndex = i - 1
    while (donorIndex >= 0 && (partitions[donorIndex]?.length ?? 0) <= 1) {
      donorIndex -= 1
    }

    if (donorIndex >= 0) {
      const moved = partitions[donorIndex]?.pop()
      if (moved) {
        partitions[i].push(moved)
      }
    }
  }

  return partitions
}

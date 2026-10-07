type TtsRequest = {
  text: string
  language: string
  voice?: string
}

export type SarvamAudioResult = {
  base64Audio?: string
  externalAudioUrl?: string
  mimeType: string
  durationMs?: number
  sampleRate?: number
  voiceModel: string
}

function requireSarvamApiKey(): string {
  const key = process.env.SARVAM_API_KEY
  if (!key) {
    throw new Error('SARVAM_API_KEY is required')
  }
  return key
}

function getSarvamTtsEndpoint(): string {
  return (
    process.env.SARVAM_TTS_ENDPOINT ?? 'https://api.sarvam.ai/text-to-speech'
  )
}

function normalizeSarvamModel(model: string): string {
  const normalized = model.trim().toLowerCase()
  if (normalized === 'bulbul-v2') {
    return 'bulbul:v2'
  }
  if (normalized === 'bulbul-v3-beta') {
    return 'bulbul:v3-beta'
  }
  if (normalized === 'bulbul-v3') {
    return 'bulbul:v3'
  }
  return model.trim()
}

function resolveSarvamVoiceConfig(voice?: string): {
  speaker: string
  model: string
} {
  const defaultSpeaker = process.env.SARVAM_TTS_SPEAKER ?? 'aditya'
  const defaultModel = normalizeSarvamModel(
    process.env.SARVAM_TTS_MODEL ?? 'bulbul:v3',
  )

  if (!voice || !voice.trim()) {
    return {
      speaker: defaultSpeaker,
      model: defaultModel,
    }
  }

  const raw = voice.trim()
  if (raw.includes('|')) {
    const [speaker, model] = raw.split('|').map((value) => value.trim())
    return {
      speaker: speaker || defaultSpeaker,
      model: model ? normalizeSarvamModel(model) : defaultModel,
    }
  }

  if (raw.toLowerCase().startsWith('bulbul:') || raw.includes('-v')) {
    return {
      speaker: defaultSpeaker,
      model: normalizeSarvamModel(raw),
    }
  }

  return {
    speaker: raw,
    model: defaultModel,
  }
}

function toSarvamLanguageCode(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (['english', 'en', 'en-us', 'en-in'].includes(normalized)) {
    return 'en-IN'
  }
  if (['hindi', 'hi'].includes(normalized)) {
    return 'hi-IN'
  }
  if (['tamil', 'ta'].includes(normalized)) {
    return 'ta-IN'
  }
  if (['telugu', 'te'].includes(normalized)) {
    return 'te-IN'
  }
  return language
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function pickString(
  obj: Record<string, unknown>,
  keys: Array<string>,
): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: Array<string>,
): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return undefined
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64')
}

function pickNested(
  root: Record<string, unknown>,
  keys: Array<string>,
): Record<string, unknown> | null {
  for (const key of keys) {
    const nested = asRecord(root[key])
    if (nested) {
      return nested
    }
  }
  return null
}

function pickFirstString(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }
  const first = value[0]
  return typeof first === 'string' ? first : undefined
}

function splitAudioCandidate(candidate: string): {
  base64Audio?: string
  externalAudioUrl?: string
} {
  if (!candidate) {
    return {}
  }
  if (/^https?:\/\//i.test(candidate)) {
    return { externalAudioUrl: candidate }
  }
  return { base64Audio: candidate }
}

function parseTtsJson(json: unknown, voiceModel: string): SarvamAudioResult {
  const root = asRecord(json) ?? {}
  const data = pickNested(root, ['data', 'result', 'output']) ?? root

  const base64AudioCandidate =
    pickString(data, ['audio_base64', 'audioBase64', 'audio']) ??
    pickString(root, ['audio_base64', 'audioBase64', 'audio'])
  const listAudioCandidate =
    pickFirstString(data.audios) ?? pickFirstString(root.audios)
  const resolved = splitAudioCandidate(
    base64AudioCandidate ?? listAudioCandidate ?? '',
  )

  const externalAudioUrlCandidate =
    pickString(data, ['audio_url', 'audioUrl', 'url']) ??
    pickString(root, ['audio_url', 'audioUrl', 'url'])
  const externalAudioUrl =
    externalAudioUrlCandidate ?? resolved.externalAudioUrl

  const mimeType =
    pickString(data, ['mime_type', 'mimeType', 'content_type']) ??
    pickString(root, ['mime_type', 'mimeType', 'content_type']) ??
    'audio/mpeg'

  const durationMs =
    pickNumber(data, ['duration_ms', 'durationMs']) ??
    pickNumber(root, ['duration_ms', 'durationMs'])

  const sampleRate =
    pickNumber(data, ['sample_rate', 'sampleRate']) ??
    pickNumber(root, ['sample_rate', 'sampleRate'])

  return {
    base64Audio: resolved.base64Audio,
    externalAudioUrl,
    mimeType,
    durationMs,
    sampleRate,
    voiceModel,
  }
}

export async function synthesizeWithSarvam({
  text,
  language,
  voice,
}: TtsRequest): Promise<SarvamAudioResult> {
  const endpoint = getSarvamTtsEndpoint()
  const apiKey = requireSarvamApiKey()
  const voiceConfig = resolveSarvamVoiceConfig(
    voice ?? process.env.SARVAM_TTS_VOICE,
  )
  const languageCode = toSarvamLanguageCode(language)

  const payload = {
    text,
    target_language_code: languageCode,
    speaker: voiceConfig.speaker,
    model: voiceConfig.model,
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': apiKey,
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sarvam TTS failed (${response.status}): ${body}`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.startsWith('audio/')) {
    const buffer = await response.arrayBuffer()
    return {
      base64Audio: arrayBufferToBase64(buffer),
      mimeType: contentType,
      voiceModel: `${voiceConfig.speaker}|${voiceConfig.model}`,
    }
  }

  const json = (await response.json()) as unknown
  const parsed = parseTtsJson(
    json,
    `${voiceConfig.speaker}|${voiceConfig.model}`,
  )
  if (!parsed.base64Audio && !parsed.externalAudioUrl) {
    throw new Error('Sarvam TTS response did not include audio payload')
  }
  return parsed
}

export type TimingCue = {
  token: string
  startMs: number
  endMs: number
  sceneId?: string
}

export type ScenePlanInput = {
  sceneId: string
  startMs: number
  endMs: number
  htmlSpec: string
  animationSpec: string
  interactionSpec?: string
}

export type ParsedSourceTopic = {
  title: string
  description?: string
  topicUuid?: string
  content: {
    script?: string
    animationMarkup?: string
    transcriptRaw?: unknown
    audioUrl?: string
  }
}

export type DiagnosticQuestion = {
  id: string
  prompt: string
  options: Array<string>
  correctOptionIndex: number
  concept: string
  difficulty: 'basic' | 'intermediate' | 'advanced'
}

export type DiagnosticAnswerInput = {
  questionId: string
  questionPrompt: string
  concept: string
  difficulty?: 'basic' | 'intermediate' | 'advanced'
  selectedOptionIndex: number
  correctOptionIndex: number
}

export type LearningPreferenceSnapshot = {
  pace: Array<string>
  depth: Array<string>
  format: Array<string>
  interactivity: Array<string>
  assessment: Array<string>
  structurePreference?: string
  customNotes?: string
}

export type CourseProfile = {
  profileSummary: string
  learnerLevel: 'beginner' | 'intermediate' | 'advanced' | 'mixed'
  confidenceScore: number
  diagnosticAccuracy: number
  answeredCount: number
  strengths: Array<string>
  gaps: Array<string>
  generatorNotes: Array<string>
}

export type PlannedTopic = {
  title: string
  brief?: string
  expectedDurationMs?: number
}

export type PipelineRunInput = {
  sourceJson?: string
  courseTopic?: string
  courseObjective?: string
  targetLanguage: string
  voice?: string
  diagnosticAnswers?: Array<DiagnosticAnswerInput>
  learningPreferences?: LearningPreferenceSnapshot
  userId?: string
}

export type PipelineTopicResult = {
  topicId: string
  title: string
  status: 'pending' | 'scripted' | 'voiced' | 'timed' | 'rendered' | 'failed'
  durationMs: number
  audioUrl: string | null
}

export type PipelineRunResult = {
  lessonId: string
  title: string
  language: string
  topics: Array<PipelineTopicResult>
}

export type LessonBundleTopic = {
  topic: {
    _id: string
    topicIndex: number
    title: string
    brief?: string
    status: string
  }
  script: {
    transcript: string
    language: string
  } | null
  audio: {
    playbackUrl: string | null
    durationMs: number
    provider: string
    voiceModel: string
  } | null
  timing: {
    frameRate: number
    cues: Array<TimingCue>
  } | null
  scenes: Array<{
    sceneId: string
    startMs: number
    endMs: number
    htmlSpec: string
    animationSpec: string
    interactionSpec?: string
  }>
}

export type LessonBundle = {
  lesson: {
    _id: string
    title: string
    language: string
    status: string
    totalDurationMs?: number
  }
  courseProfile: {
    topic: string
    objective?: string
    courseSummary: string
    learnerLevel: 'beginner' | 'intermediate' | 'advanced' | 'mixed'
    confidenceScore: number
    profileSummary: string
    strengths: Array<string>
    gaps: Array<string>
    generatorNotes: Array<string>
    preferences: LearningPreferenceSnapshot
    answeredCount: number
    diagnosticAccuracy: number
  } | null
  topics: Array<LessonBundleTopic>
}
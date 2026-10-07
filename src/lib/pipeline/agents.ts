import { generateObject } from 'ai'
import { z } from 'zod'
import type {
  CourseProfile,
  DiagnosticAnswerInput,
  DiagnosticQuestion,
  LearningPreferenceSnapshot,
} from './types'
import { getProfilerModel, getQuestionnaireModel } from '@/lib/ai/provider'

const questionSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        prompt: z.string().min(12),
        options: z.array(z.string().min(1)).min(4).max(5),
        correctOptionIndex: z.number().int().min(0).max(4),
        concept: z.string().min(1),
        difficulty: z.enum(['basic', 'intermediate', 'advanced']),
      }),
    )
    .min(6)
    .max(16),
})

const profileSchema = z.object({
  profileSummary: z.string().min(40),
  learnerLevel: z.enum(['beginner', 'intermediate', 'advanced', 'mixed']),
  strengths: z.array(z.string().min(2)).min(1).max(6),
  gaps: z.array(z.string().min(2)).min(1).max(6),
  generatorNotes: z.array(z.string().min(6)).min(2).max(8),
})

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function computeDiagnosticStats(answers: Array<DiagnosticAnswerInput>): {
  answeredCount: number
  diagnosticAccuracy: number
  confidenceScore: number
} {
  if (answers.length === 0) {
    return {
      answeredCount: 0,
      diagnosticAccuracy: 0.5,
      confidenceScore: 0.25,
    }
  }

  const answeredCount = answers.length
  const correctCount = answers.filter(
    (answer) => answer.selectedOptionIndex === answer.correctOptionIndex,
  ).length
  const diagnosticAccuracy = correctCount / answeredCount
  const knowledgeSeparation = Math.abs(diagnosticAccuracy - 0.5) * 2
  const sampleStrength = Math.min(1, answeredCount / 10)
  const conceptCoverage = clamp01(
    new Set(answers.map((answer) => answer.concept).filter(Boolean)).size /
      Math.min(6, answeredCount),
  )
  const difficultyCoverage = clamp01(
    new Set(
      answers
        .map((answer) => answer.difficulty)
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    ).size / 3,
  )

  const confidenceScore = clamp01(
    0.2 +
      sampleStrength * 0.45 +
      knowledgeSeparation * 0.2 +
      conceptCoverage * 0.1 +
      difficultyCoverage * 0.05,
  )

  return {
    answeredCount,
    diagnosticAccuracy,
    confidenceScore,
  }
}

function inferLearnerLevel(
  accuracy: number,
): 'beginner' | 'intermediate' | 'advanced' | 'mixed' {
  if (accuracy >= 0.78) {
    return 'advanced'
  }
  if (accuracy >= 0.55) {
    return 'intermediate'
  }
  if (accuracy <= 0.35) {
    return 'beginner'
  }
  return 'mixed'
}

function fallbackQuestions(
  topic: string,
  count: number,
): Array<DiagnosticQuestion> {
  const prompts = [
    `Which statement best describes the main idea behind ${topic}?`,
    `In ${topic}, what is usually the first concept to verify before details?`,
    `When comparing two approaches in ${topic}, what should be prioritized first?`,
    `What is a common misconception beginners have in ${topic}?`,
    `Which signal most clearly indicates deeper understanding of ${topic}?`,
    `In practical work, how does ${topic} affect decision quality?`,
    `Which tradeoff appears most often while applying ${topic}?`,
    `What kind of example best validates understanding of ${topic}?`,
    `When debugging ${topic}-related issues, what should be checked first?`,
    `What is the strongest reason to structure learning in ${topic} progressively?`,
    `In ${topic}, when should advanced techniques be introduced?`,
    `What evidence best shows mastery of ${topic}?`,
  ]

  return Array.from({ length: count }, (_, index) => {
    const prompt = prompts[index % prompts.length]
    return {
      id: `q-${Date.now()}-${index + 1}`,
      prompt,
      options: [
        'Rely only on memorized definitions',
        'Prioritize conceptual model, then examples, then edge cases',
        'Skip foundations and start from rare edge cases',
        'Focus on unrelated tooling details first',
      ],
      correctOptionIndex: 1,
      concept: `core-${(index % 4) + 1}`,
      difficulty: index < 4 ? 'basic' : index < 8 ? 'intermediate' : 'advanced',
    }
  })
}

export async function generateDiagnosticQuestions(args: {
  topic: string
  objective?: string
  count?: number
  focusConcepts?: Array<string>
}): Promise<Array<DiagnosticQuestion>> {
  const count = Math.min(16, Math.max(6, args.count ?? 12))

  try {
    const { object } = await generateObject({
      model: getQuestionnaireModel(),
      schema: questionSchema,
      prompt: `You are QuestionnaireAgent.
Create ${count} diagnostic multiple-choice questions to estimate learner knowledge for this topic.
Questions must progress from basic to advanced and have one clear correct answer.
Keep options concise and plausible.

Topic: ${args.topic}
Objective: ${args.objective ?? 'N/A'}
Focus concepts: ${args.focusConcepts?.join(', ') ?? 'N/A'}

Output valid structured data only.`,
    })

    return object.questions.slice(0, count).map((question, index) => ({
      ...question,
      id: question.id.trim() || `q-${index + 1}`,
      correctOptionIndex: Math.min(
        Math.max(0, question.correctOptionIndex),
        Math.max(0, question.options.length - 1),
      ),
    }))
  } catch {
    return fallbackQuestions(args.topic, count)
  }
}

function formatPreferences(preferences: LearningPreferenceSnapshot): string {
  const rows = [
    `pace=${preferences.pace.join(', ') || 'none'}`,
    `depth=${preferences.depth.join(', ') || 'none'}`,
    `format=${preferences.format.join(', ') || 'none'}`,
    `interactivity=${preferences.interactivity.join(', ') || 'none'}`,
    `assessment=${preferences.assessment.join(', ') || 'none'}`,
    `structurePreference=${preferences.structurePreference ?? 'N/A'}`,
    `customNotes=${preferences.customNotes ?? 'N/A'}`,
  ]
  return rows.join('\n')
}

export async function buildCourseProfile(args: {
  topic: string
  objective?: string
  targetLanguage: string
  diagnosticAnswers: Array<DiagnosticAnswerInput>
  learningPreferences: LearningPreferenceSnapshot
}): Promise<CourseProfile> {
  const stats = computeDiagnosticStats(args.diagnosticAnswers)
  const learnerLevel = inferLearnerLevel(stats.diagnosticAccuracy)

  try {
    const { object } = await generateObject({
      model: getProfilerModel(),
      schema: profileSchema,
      prompt: `You are ProfilerAgent.
Summarize learner readiness and produce generator guidance for an automated interactive course builder.
Write practical and specific profile output.

Course topic: ${args.topic}
Objective: ${args.objective ?? 'N/A'}
Language: ${args.targetLanguage}

Diagnostic stats:
- answeredCount: ${stats.answeredCount}
- diagnosticAccuracy: ${stats.diagnosticAccuracy.toFixed(3)}
- confidenceScore: ${stats.confidenceScore.toFixed(3)}
- inferredLevel: ${learnerLevel}

Preference snapshot:
${formatPreferences(args.learningPreferences)}

Sample answers (latest first):
${JSON.stringify(args.diagnosticAnswers.slice(-8), null, 2)}

Return output tuned for downstream generation prompts.`,
    })

    return {
      ...object,
      confidenceScore: stats.confidenceScore,
      diagnosticAccuracy: stats.diagnosticAccuracy,
      answeredCount: stats.answeredCount,
    }
  } catch {
    const summary = `Learner profile for ${args.topic}: ${learnerLevel} level with ${(stats.diagnosticAccuracy * 100).toFixed(0)}% diagnostic accuracy and ${(stats.confidenceScore * 100).toFixed(0)}% profiling confidence. Prioritize ${args.learningPreferences.format.join(', ') || 'mixed explanation styles'} with ${args.learningPreferences.interactivity.join(', ') || 'medium interactivity'}.`

    return {
      profileSummary: summary,
      learnerLevel,
      confidenceScore: stats.confidenceScore,
      diagnosticAccuracy: stats.diagnosticAccuracy,
      answeredCount: stats.answeredCount,
      strengths: ['Concept recognition', 'Pattern identification'],
      gaps: ['Edge-case reasoning', 'Transfer to new scenarios'],
      generatorNotes: [
        'Start with short, visual examples and quick checks for understanding.',
        'Increase complexity gradually and insert recap cues between sections.',
      ],
    }
  }
}

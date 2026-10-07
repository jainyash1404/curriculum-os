import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type {
  CourseProfile,
  DiagnosticAnswerInput,
  DiagnosticQuestion,
  LearningPreferenceSnapshot,
  LessonBundle,
  PipelineRunResult,
} from '@/lib/pipeline/types'
import {
  buildCourseProfileServerFn,
  generateDiagnosticQuestionsServerFn,
  getLessonBundleServerFn,
  listLessonsServerFn,
  runLessonPipelineServerFn,
} from '@/lib/pipeline/server'
import { getCurrentUserServerFn } from '@/lib/auth/server'
import { LessonPlayer } from '@/components/lesson-player'

export const Route = createFileRoute('/studio')({ component: App })

type LessonListItem = {
  _id: string
  title: string
  language: string
  status: string
}

type WizardStep = 'topic' | 'diagnostic' | 'preferences' | 'review'

type AnswerDraft = {
  selectedOptionIndex: number
}

type MultiPreferenceKey =
  | 'pace'
  | 'depth'
  | 'format'
  | 'interactivity'
  | 'assessment'

const diagnosticThreshold = 0.78

const languageOptions = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'telugu', label: 'Telugu' },
]

const defaultPreferences: LearningPreferenceSnapshot = {
  pace: ['medium'],
  depth: ['mixed'],
  format: ['examples first'],
  interactivity: ['high'],
  assessment: ['each topic'],
  structurePreference: '',
  customNotes: '',
}

const preferenceOptions: Record<MultiPreferenceKey, Array<string>> = {
  pace: ['slow', 'medium', 'fast'],
  depth: ['intuitive', 'balanced', 'rigorous'],
  format: ['examples first', 'theory first', 'mixed'],
  interactivity: ['low', 'medium', 'high'],
  assessment: ['minimal', 'each topic', 'frequent micro-checks'],
}

const stepOrder: Array<WizardStep> = [
  'topic',
  'diagnostic',
  'preferences',
  'review',
]

const stepLabels: Record<WizardStep, string> = {
  topic: 'Topic',
  diagnostic: 'Diagnostic',
  preferences: 'Preferences',
  review: 'Review',
}

const preferenceLabels: Record<MultiPreferenceKey, string> = {
  pace: 'Pace',
  depth: 'Depth',
  format: 'Format',
  interactivity: 'Interactivity',
  assessment: 'Assessments',
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function computeDiagnosticStats(answers: Array<DiagnosticAnswerInput>) {
  if (answers.length === 0) {
    return {
      answeredCount: 0,
      correctCount: 0,
      diagnosticAccuracy: 0,
      confidenceScore: 0,
    }
  }

  const correctCount = answers.filter(
    (answer) => answer.selectedOptionIndex === answer.correctOptionIndex,
  ).length

  const diagnosticAccuracy = correctCount / answers.length
  const sampleStrength = Math.min(1, answers.length / 10)
  const knowledgeSeparation = Math.abs(diagnosticAccuracy - 0.5) * 2
  const conceptCoverage = clamp01(
    new Set(answers.map((answer) => answer.concept).filter(Boolean)).size /
      Math.min(6, answers.length),
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
    answeredCount: answers.length,
    correctCount,
    diagnosticAccuracy,
    confidenceScore,
  }
}

function buildDraftCourseSummary(args: {
  topic: string
  objective: string
  profile: CourseProfile | null
  language: string
  preferences: LearningPreferenceSnapshot
}): string {
  const topic = args.topic.trim()
  if (!topic) {
    return ''
  }

  const objectivePart = args.objective.trim()
    ? `Objective: ${args.objective.trim()}.`
    : ''

  const profilePart = args.profile
    ? `Level: ${args.profile.learnerLevel}, confidence ${(args.profile.confidenceScore * 100).toFixed(0)}%.`
    : 'Level is being inferred from diagnostics.'

  const format = args.preferences.format.join(', ') || 'mixed format'
  const interactivity =
    args.preferences.interactivity.join(', ') || 'medium interactivity'

  return [
    `Course on ${topic} in ${args.language}.`,
    objectivePart,
    profilePart,
    `Delivery style: ${format} with ${interactivity}.`,
  ]
    .filter(Boolean)
    .join(' ')
}

function App() {
  const runPipeline = useServerFn(runLessonPipelineServerFn)
  const getBundle = useServerFn(getLessonBundleServerFn)
  const listLessons = useServerFn(listLessonsServerFn)
  const generateQuestions = useServerFn(generateDiagnosticQuestionsServerFn)
  const buildProfile = useServerFn(buildCourseProfileServerFn)
  const getCurrentUser = useServerFn(getCurrentUserServerFn)

  const [authUser, setAuthUser] = React.useState<
    { email: string } | null | 'loading'
  >('loading')

  React.useEffect(() => {
    let cancelled = false
    getCurrentUser()
      .then((u) => {
        if (!cancelled) setAuthUser(u)
      })
      .catch(() => {
        if (!cancelled) setAuthUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [getCurrentUser])

  const [step, setStep] = React.useState<WizardStep>('topic')
  const [courseTopic, setCourseTopic] = React.useState('')
  const [courseObjective, setCourseObjective] = React.useState('')
  const [targetLanguage, setTargetLanguage] = React.useState('english')
  const [voice, setVoice] = React.useState('aditya|bulbul:v3')
  const [questions, setQuestions] = React.useState<Array<DiagnosticQuestion>>(
    [],
  )
  const [answersById, setAnswersById] = React.useState<
    Partial<Record<string, AnswerDraft>>
  >({})
  const [activeQuestionIndex, setActiveQuestionIndex] = React.useState(0)
  const [learningPreferences, setLearningPreferences] =
    React.useState<LearningPreferenceSnapshot>(defaultPreferences)
  const [profilePreview, setProfilePreview] =
    React.useState<CourseProfile | null>(null)
  const [bundle, setBundle] = React.useState<LessonBundle | null>(null)
  const [lessonHistory, setLessonHistory] = React.useState<
    Array<LessonListItem>
  >([])
  const [runResult, setRunResult] = React.useState<PipelineRunResult | null>(
    null,
  )
  const [status, setStatus] = React.useState('idle')
  // Drives the sequential stage highlight in the "generating" panel below.
  // This is a UX estimate (not a literal live signal from the backend
  // pipeline) — it advances on a timer so the user sees *something* moving
  // instead of a single frozen spinner during the ~1-2min generation call.
  const [activeStageIndex, setActiveStageIndex] = React.useState(0)
  React.useEffect(() => {
    if (status !== 'running') {
      setActiveStageIndex(0)
      return
    }
    const stageCount = 6
    const estimatedTotalMs = 90_000
    const interval = setInterval(() => {
      setActiveStageIndex((i) => Math.min(i + 1, stageCount - 1))
    }, estimatedTotalMs / stageCount)
    return () => clearInterval(interval)
  }, [status])
  const [error, setError] = React.useState<string | null>(null)

  const refreshLessonList = React.useCallback(async () => {
    const items = (await listLessons({
      data: { limit: 20 },
    })) as Array<LessonListItem>
    setLessonHistory(items)
  }, [listLessons])

  React.useEffect(() => {
    void refreshLessonList()
  }, [refreshLessonList])

  const diagnosticAnswers = React.useMemo(() => {
    return questions.flatMap((question) => {
      const answer = answersById[question.id]
      if (!answer) {
        return []
      }

      return [
        {
          questionId: question.id,
          questionPrompt: question.prompt,
          concept: question.concept,
          difficulty: question.difficulty,
          selectedOptionIndex: answer.selectedOptionIndex,
          correctOptionIndex: question.correctOptionIndex,
        },
      ]
    })
  }, [answersById, questions])

  const diagnosticStats = React.useMemo(
    () => computeDiagnosticStats(diagnosticAnswers),
    [diagnosticAnswers],
  )

  const canMoveFromDiagnostic =
    diagnosticStats.answeredCount >= 6 &&
    diagnosticStats.confidenceScore >= diagnosticThreshold

  const activeQuestion = questions.at(activeQuestionIndex)
  const activeAnswer = activeQuestion
    ? answersById[activeQuestion.id]
    : undefined

  const statusLabel =
    status === 'loading-questions'
      ? 'Building diagnostic questions'
      : status === 'building-profile'
        ? 'Profiling learner'
        : status === 'running'
          ? 'Generating course'
          : status === 'loading'
            ? 'Loading course'
            : status === 'done'
              ? 'Course ready'
              : status === 'loaded'
                ? 'Course loaded'
                : 'Idle'

  const activeStepIndex = stepOrder.indexOf(step)

  const draftCourseSummary = React.useMemo(
    () =>
      buildDraftCourseSummary({
        topic: courseTopic,
        objective: courseObjective,
        profile: profilePreview,
        language: targetLanguage,
        preferences: learningPreferences,
      }),
    [
      courseTopic,
      courseObjective,
      profilePreview,
      targetLanguage,
      learningPreferences,
    ],
  )

  function togglePreference(key: MultiPreferenceKey, value: string) {
    setLearningPreferences((previous) => {
      const existing = previous[key]
      const next = existing.includes(value)
        ? existing.filter((item) => item !== value)
        : [...existing, value]
      return {
        ...previous,
        [key]: next,
      }
    })
  }

  async function handleStartDiagnostic() {
    if (!courseTopic.trim()) {
      setError('Please provide a course topic first.')
      return
    }

    setStatus('loading-questions')
    setError(null)

    try {
      const generated = await generateQuestions({
        data: {
          topic: courseTopic.trim(),
          objective: courseObjective.trim() || undefined,
          count: 12,
        },
      })

      setQuestions(generated)
      setAnswersById({})
      setActiveQuestionIndex(0)
      setProfilePreview(null)
      setStep('diagnostic')
      setStatus('idle')
    } catch (questionError) {
      setStatus('idle')
      setError(
        questionError instanceof Error
          ? questionError.message
          : 'Failed to build diagnostic questions',
      )
    }
  }

  function setCurrentQuestionAnswer(patch: Partial<AnswerDraft>) {
    if (!activeQuestion) {
      return
    }

    setAnswersById((previous) => {
      const current = previous[activeQuestion.id] ?? {
        selectedOptionIndex: -1,
      }

      return {
        ...previous,
        [activeQuestion.id]: {
          ...current,
          ...patch,
        },
      }
    })
  }

  async function handleFollowUpQuestions() {
    if (!courseTopic.trim()) {
      return
    }

    const weakConcepts = diagnosticAnswers
      .filter(
        (answer) => answer.selectedOptionIndex !== answer.correctOptionIndex,
      )
      .map((answer) => answer.concept)
      .filter(Boolean)

    setStatus('loading-questions')
    setError(null)

    try {
      const followUps = await generateQuestions({
        data: {
          topic: courseTopic.trim(),
          objective: courseObjective.trim() || undefined,
          count: 6,
          focusConcepts: weakConcepts,
        },
      })

      const previousLength = questions.length
      const withStableIds = followUps.map((question, index) => ({
        ...question,
        id: `${question.id}-f${Date.now()}-${index + 1}`,
      }))

      setQuestions((previous) => [...previous, ...withStableIds])
      setActiveQuestionIndex((previous) => Math.max(previous, previousLength))
      setStatus('idle')
    } catch (followUpError) {
      setStatus('idle')
      setError(
        followUpError instanceof Error
          ? followUpError.message
          : 'Failed to create follow-up questions',
      )
    }
  }

  async function handleBuildProfile() {
    if (!courseTopic.trim()) {
      setError('Topic is required to build profile summary.')
      return false
    }
    if (diagnosticAnswers.length === 0) {
      setError('Answer a few diagnostic questions before review.')
      return false
    }

    setStatus('building-profile')
    setError(null)

    try {
      const profile = await buildProfile({
        data: {
          topic: courseTopic.trim(),
          objective: courseObjective.trim() || undefined,
          targetLanguage,
          diagnosticAnswers,
          learningPreferences,
        },
      })

      setProfilePreview(profile)
      setStatus('idle')
      return true
    } catch (profileError) {
      setStatus('idle')
      setError(
        profileError instanceof Error
          ? profileError.message
          : 'Failed to build learner profile',
      )
      return false
    }
  }

  async function handleGenerateCourse() {
    if (!courseTopic.trim()) {
      setError('Topic is required.')
      return
    }

    let profileReady = profilePreview !== null
    if (!profileReady) {
      profileReady = await handleBuildProfile()
    }
    if (!profileReady) {
      return
    }

    setStatus('running')
    setError(null)
    setBundle(null)
    setRunResult(null)

    try {
      const result = await runPipeline({
        data: {
          courseTopic: courseTopic.trim(),
          courseObjective: courseObjective.trim() || undefined,
          targetLanguage,
          voice: voice.trim() || undefined,
          diagnosticAnswers,
          learningPreferences,
        },
      })

      setRunResult(result)

      const fetched = await getBundle({
        data: { lessonId: result.lessonId },
      })

      setBundle(fetched)
      setStatus('done')
      await refreshLessonList()
    } catch (runError) {
      setStatus('idle')
      setError(
        runError instanceof Error ? runError.message : 'Generation failed',
      )
    }
  }

  async function handleLoadLesson(lessonId: string) {
    setStatus('loading')
    setError(null)
    const fetched = await getBundle({
      data: { lessonId },
    })
    setBundle(fetched)
    setStatus('loaded')
  }

  const createdTopics = runResult?.topics.length ?? 0
  const totalDurationMs = runResult?.topics.reduce(
    (sum, topic) => sum + topic.durationMs,
    0,
  )

  const answeredCurrentQuestion = (activeAnswer?.selectedOptionIndex ?? -1) >= 0

  if (authUser === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fcfbf9]">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-[#4338ca]" />
      </main>
    )
  }

  if (authUser === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fcfbf9] px-6 text-center">
        <p className="oi-mono-label text-[#4338ca]">Sign in required</p>
        <h1 className="max-w-md font-serif text-2xl font-bold text-[#171717]">
          Sign in to generate a course.
        </h1>
        <p className="max-w-md text-sm text-neutral-500">
          Courses are tied to your account so you can find, replay, and
          delete them later — sign in or create a free account to continue.
        </p>
        <div className="mt-2 flex gap-3">
          <Link
            to="/sign-in"
            className="rounded-full bg-[#4338ca] px-6 py-2.5 text-sm text-white transition hover:bg-[#3730a3]"
          >
            Sign in
          </Link>
          <Link
            to="/sign-up"
            className="rounded-full border border-[#e5e5e5] px-6 py-2.5 text-sm text-[#171717] transition hover:border-neutral-300"
          >
            Sign up
          </Link>
        </div>
        <Link to="/demo" className="mt-4 text-xs text-neutral-400 underline">
          Or try the live demo without an account
        </Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#fcfbf9]">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-32 top-0 h-[420px] w-[420px] rounded-full bg-indigo-200/45 blur-[120px]" />
        <div className="absolute -right-24 top-24 h-[340px] w-[340px] rounded-full bg-purple-200/35 blur-[110px]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-[#e5e5e5] bg-[#fcfbf9]/88 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-serif text-xl italic text-[#171717]">
              CurriculumOS
            </Link>
            <nav className="hidden items-center gap-5 md:flex">
              <Link
                to="/courses"
                className="oi-nav-link text-neutral-500 transition-colors hover:text-[#171717]"
              >
                Courses
              </Link>
              <Link to="/studio" className="oi-nav-link text-[#171717]">
                Studio
              </Link>
            </nav>
          </div>

          <div
            className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.3em]"
            style={{
              borderColor:
                status === 'running' ||
                status === 'loading-questions' ||
                status === 'building-profile' ||
                status === 'loading'
                  ? '#c7d2fe'
                  : status === 'done' || status === 'loaded'
                    ? '#a7f3d0'
                    : '#e0e7ff',
              backgroundColor:
                status === 'running' ||
                status === 'loading-questions' ||
                status === 'building-profile' ||
                status === 'loading'
                  ? '#eef2ff'
                  : status === 'done' || status === 'loaded'
                    ? '#ecfdf5'
                    : '#eef2ff',
              color:
                status === 'done' || status === 'loaded'
                  ? '#065f46'
                  : '#4338ca',
            }}
          >
            {(status === 'running' ||
              status === 'loading-questions' ||
              status === 'building-profile' ||
              status === 'loading') && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-indigo-300 border-t-[#4338ca]" />
            )}
            {(status === 'done' || status === 'loaded') && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M2 6.5L4.5 9L10 3" />
              </svg>
            )}
            {statusLabel}
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-7xl px-6 pb-10 pt-10">
        <div className="oi-reveal flex items-start justify-between gap-8">
          <div>
            <p className="oi-mono-label text-[#4338ca]">Course Studio</p>
            <h1 className="mt-3 max-w-4xl font-serif text-4xl font-bold leading-[0.95] text-[#171717] md:text-6xl">
              Build a personalized
              <br />
              <em className="font-normal italic">interactive course</em>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-neutral-500 md:text-base">
              Topic, diagnostics, preferences, generation — four steps to a
              fully personalized course.
            </p>
          </div>

          {/* Step progress — compact horizontal */}
          <div className="hidden shrink-0 pt-3 md:flex md:items-center md:gap-0">
            {stepOrder.map((stepId, index) => {
              const isActive = step === stepId
              const isCompleted = index < activeStepIndex
              return (
                <React.Fragment key={stepId}>
                  {index > 0 && (
                    <div
                      className="h-px w-8 transition-colors duration-500"
                      style={{
                        backgroundColor:
                          index <= activeStepIndex ? '#4338ca' : '#e5e5e5',
                        transitionTimingFunction: 'var(--ease-premium)',
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setStep(stepId)}
                    className="group flex flex-col items-center gap-1.5"
                  >
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-all duration-500"
                      style={{
                        backgroundColor: isActive
                          ? '#4338ca'
                          : isCompleted
                            ? '#059669'
                            : '#fff',
                        color: isActive || isCompleted ? '#fff' : '#a3a3a3',
                        border:
                          isActive || isCompleted
                            ? 'none'
                            : '1.5px solid #e5e5e5',
                        boxShadow: isActive
                          ? '0 4px 14px -3px rgba(67,56,202,0.4)'
                          : 'none',
                        transitionTimingFunction: 'var(--ease-premium)',
                      }}
                    >
                      {isCompleted ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2.5 7.5L5.5 10.5L11.5 3.5" />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.2em] transition-colors duration-300"
                      style={{
                        color: isActive
                          ? '#4338ca'
                          : isCompleted
                            ? '#059669'
                            : '#a3a3a3',
                      }}
                    >
                      {stepLabels[stepId]}
                    </span>
                  </button>
                </React.Fragment>
              )
            })}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_360px]">
          <section className="rounded-[1.5rem] border border-[#e5e5e5] bg-white/90 p-5 shadow-[0_16px_50px_-35px_rgba(23,23,23,0.35)] backdrop-blur md:p-6">
            {/* Mobile step indicator */}
            <div className="mb-6 flex flex-wrap gap-2 md:hidden">
              {stepOrder.map((stepId, index) => {
                const isActive = step === stepId
                const isCompleted = index < activeStepIndex
                return (
                  <button
                    key={stepId}
                    type="button"
                    onClick={() => setStep(stepId)}
                    className={
                      isActive
                        ? 'rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700'
                        : isCompleted
                          ? 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700'
                          : 'rounded-full border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500'
                    }
                  >
                    {index + 1}. {stepLabels[stepId]}
                  </button>
                )
              })}
            </div>

            {step === 'topic' ? (
              <div className="space-y-6">
                <div>
                  <h2 className="font-serif text-3xl font-bold leading-[1] text-[#171717]">
                    Topic setup
                  </h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    What should this course teach? The AI generates diagnostics
                    from your topic.
                  </p>
                </div>

                <label className="block space-y-2 text-sm">
                  <span className="oi-mono-label text-neutral-500">
                    Course topic
                  </span>
                  <input
                    className="w-full rounded-xl border border-[#e5e5e5] bg-white px-4 py-3.5 text-[15px] outline-none transition-all duration-300 placeholder:text-neutral-300 focus:border-[#4338ca]/40 focus:shadow-[0_0_0_3px_rgba(67,56,202,0.08)]"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    value={courseTopic}
                    onChange={(event) => setCourseTopic(event.target.value)}
                    placeholder="e.g. Distributed systems for frontend engineers"
                  />
                </label>

                <label className="block space-y-2 text-sm">
                  <span className="oi-mono-label text-neutral-500">
                    Goal{' '}
                    <span className="normal-case tracking-normal text-neutral-400">
                      (optional)
                    </span>
                  </span>
                  <textarea
                    className="h-24 w-full resize-none rounded-xl border border-[#e5e5e5] bg-white px-4 py-3.5 text-sm leading-relaxed outline-none transition-all duration-300 placeholder:text-neutral-300 focus:border-[#4338ca]/40 focus:shadow-[0_0_0_3px_rgba(67,56,202,0.08)]"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    value={courseObjective}
                    onChange={(event) => setCourseObjective(event.target.value)}
                    placeholder="What should the learner be able to do after this course?"
                  />
                </label>

                <div>
                  <p className="oi-mono-label mb-2.5 text-neutral-500">
                    Language
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {languageOptions.map((option) => {
                      const isSelected = targetLanguage === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setTargetLanguage(option.value)}
                          className="rounded-full px-4 py-2 text-sm font-medium transition-all duration-300"
                          style={{
                            backgroundColor: isSelected ? '#4338ca' : '#fff',
                            color: isSelected ? '#fff' : '#525252',
                            border: isSelected
                              ? '1.5px solid #4338ca'
                              : '1.5px solid #e5e5e5',
                            boxShadow: isSelected
                              ? '0 2px 8px -2px rgba(67,56,202,0.3)'
                              : 'none',
                            transitionTimingFunction: 'var(--ease-premium)',
                          }}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <label className="block space-y-2 text-sm">
                  <span className="oi-mono-label text-neutral-500">
                    Voice model
                  </span>
                  <input
                    className="w-full rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 text-sm outline-none transition-all duration-300 placeholder:text-neutral-300 focus:border-[#4338ca]/40 focus:shadow-[0_0_0_3px_rgba(67,56,202,0.08)]"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    value={voice}
                    onChange={(event) => setVoice(event.target.value)}
                    placeholder="aditya|bulbul:v3"
                  />
                </label>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleStartDiagnostic()}
                    className="rounded-full bg-[#4338ca] px-7 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-white transition-all duration-300 hover:bg-[#3730a3] hover:shadow-[0_4px_16px_-4px_rgba(67,56,202,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    disabled={
                      status === 'loading-questions' || !courseTopic.trim()
                    }
                  >
                    {status === 'loading-questions' ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Generating...
                      </span>
                    ) : (
                      'Start diagnostic'
                    )}
                  </button>
                  {!courseTopic.trim() && (
                    <span className="text-xs text-neutral-400">
                      Enter a topic to continue
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            {step === 'diagnostic' ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-3xl font-bold leading-[1] text-[#171717]">
                      Diagnostic interview
                    </h2>
                    <p className="mt-2 text-sm text-neutral-500">
                      Answer questions so the AI can gauge your level. It keeps
                      asking until confident.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-full border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-neutral-500 transition hover:border-neutral-300"
                    onClick={() => setStep('topic')}
                  >
                    Edit topic
                  </button>
                </div>

                {/* Progress banner */}
                <div className="rounded-2xl border border-[#e5e5e5] bg-gradient-to-r from-indigo-50/60 to-white p-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-2xl font-bold text-[#4338ca]">
                        {(diagnosticStats.confidenceScore * 100).toFixed(0)}%
                      </span>
                      <span className="text-xs text-neutral-500">
                        confidence
                      </span>
                    </div>
                    <div className="hidden h-6 w-px bg-[#e5e5e5] sm:block" />
                    <span className="text-sm text-neutral-600">
                      {diagnosticStats.answeredCount}/{questions.length}{' '}
                      answered
                    </span>
                    <div className="hidden h-6 w-px bg-[#e5e5e5] sm:block" />
                    <span className="text-sm text-neutral-600">
                      {(diagnosticStats.diagnosticAccuracy * 100).toFixed(0)}%
                      accuracy
                    </span>
                  </div>
                  <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200/70">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-[#4338ca] transition-all duration-700"
                      style={{
                        width: `${Math.round(diagnosticStats.confidenceScore * 100)}%`,
                        transitionTimingFunction: 'var(--ease-premium)',
                      }}
                    />
                    {/* Threshold marker */}
                    <div
                      className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-neutral-400"
                      style={{
                        left: `${Math.round(diagnosticThreshold * 100)}%`,
                      }}
                      title={`Threshold: ${Math.round(diagnosticThreshold * 100)}%`}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-neutral-400">
                    Threshold to continue:{' '}
                    {Math.round(diagnosticThreshold * 100)}%
                  </p>
                </div>

                {/* Question dots — quick navigation */}
                {questions.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {questions.map((q, qi) => {
                      const isAnswered = Boolean(answersById[q.id])
                      const isCurrent = qi === activeQuestionIndex
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setActiveQuestionIndex(qi)}
                          className="h-2 rounded-full transition-all duration-300"
                          style={{
                            width: isCurrent ? '20px' : '8px',
                            backgroundColor: isCurrent
                              ? '#4338ca'
                              : isAnswered
                                ? '#a5b4fc'
                                : '#e5e5e5',
                            transitionTimingFunction: 'var(--ease-premium)',
                          }}
                          title={`Question ${qi + 1}`}
                        />
                      )
                    })}
                  </div>
                )}

                {activeQuestion ? (
                  <article className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
                    <div className="flex items-center justify-between">
                      <p className="oi-mono-label text-[#4338ca]">
                        Question {activeQuestionIndex + 1} / {questions.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                          {activeQuestion.concept}
                        </span>
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                          {activeQuestion.difficulty}
                        </span>
                      </div>
                    </div>
                    <h3 className="mt-4 text-[17px] font-medium leading-snug text-[#171717]">
                      {activeQuestion.prompt}
                    </h3>

                    <div className="mt-5 space-y-2">
                      {activeQuestion.options.map((option, optionIndex) => {
                        const isSelected =
                          activeAnswer?.selectedOptionIndex === optionIndex
                        return (
                          <button
                            key={`${activeQuestion.id}-${optionIndex}`}
                            type="button"
                            onClick={() =>
                              setCurrentQuestionAnswer({
                                selectedOptionIndex: optionIndex,
                              })
                            }
                            className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all duration-300"
                            style={{
                              borderColor: isSelected ? '#a5b4fc' : '#e5e5e5',
                              backgroundColor: isSelected ? '#eef2ff' : '#fff',
                              transitionTimingFunction: 'var(--ease-premium)',
                            }}
                          >
                            <span
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all duration-300"
                              style={{
                                borderColor: isSelected ? '#4338ca' : '#d4d4d4',
                                backgroundColor: isSelected
                                  ? '#4338ca'
                                  : 'transparent',
                                color: isSelected ? '#fff' : '#a3a3a3',
                              }}
                            >
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            <span className="text-neutral-800">{option}</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full border border-[#e5e5e5] bg-white px-4 py-2 text-sm transition hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() =>
                          setActiveQuestionIndex((previous) =>
                            Math.max(0, previous - 1),
                          )
                        }
                        disabled={activeQuestionIndex === 0}
                      >
                        <svg
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          viewBox="0 0 14 14"
                        >
                          <path d="M8.5 3.5L5 7l3.5 3.5" />
                        </svg>
                        Prev
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-full border border-[#e5e5e5] bg-white px-4 py-2 text-sm transition hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() =>
                          setActiveQuestionIndex((previous) =>
                            Math.min(questions.length - 1, previous + 1),
                          )
                        }
                        disabled={
                          !answeredCurrentQuestion ||
                          activeQuestionIndex >= questions.length - 1
                        }
                      >
                        Next
                        <svg
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          viewBox="0 0 14 14"
                        >
                          <path d="M5.5 3.5L9 7l-3.5 3.5" />
                        </svg>
                      </button>

                      <div className="flex-1" />

                      {canMoveFromDiagnostic ? (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 rounded-full bg-[#4338ca] px-5 py-2 text-sm font-semibold text-white transition-all duration-300 hover:bg-[#3730a3] hover:shadow-[0_4px_16px_-4px_rgba(67,56,202,0.4)]"
                          style={{
                            transitionTimingFunction: 'var(--ease-premium)',
                          }}
                          onClick={() => setStep('preferences')}
                        >
                          Continue
                          <svg
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            viewBox="0 0 14 14"
                          >
                            <path d="M5.5 3.5L9 7l-3.5 3.5" />
                          </svg>
                        </button>
                      ) : null}

                      {!canMoveFromDiagnostic &&
                      diagnosticStats.answeredCount >= questions.length ? (
                        <button
                          type="button"
                          className="rounded-full bg-neutral-900 px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-neutral-800 disabled:opacity-50"
                          onClick={() => void handleFollowUpQuestions()}
                          disabled={status === 'loading-questions'}
                        >
                          {status === 'loading-questions' ? (
                            <span className="flex items-center gap-2">
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              Generating...
                            </span>
                          ) : (
                            'More questions'
                          )}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ) : (
                  <p className="rounded-xl border border-[#e5e5e5] bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
                    No diagnostic questions available.
                  </p>
                )}
              </div>
            ) : null}

            {step === 'preferences' ? (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-3xl font-bold leading-[1] text-[#171717]">
                      Learning preferences
                    </h2>
                    <p className="mt-2 text-sm text-neutral-500">
                      How should this course be structured? Select all that
                      apply.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-full border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-neutral-500 transition hover:border-neutral-300"
                    onClick={() => setStep('diagnostic')}
                  >
                    Back
                  </button>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  {(
                    Object.keys(preferenceOptions) as Array<MultiPreferenceKey>
                  ).map((key) => (
                    <div
                      key={key}
                      className="rounded-xl border border-[#e5e5e5] bg-neutral-50/50 p-4"
                    >
                      <p className="oi-mono-label mb-3 text-neutral-500">
                        {preferenceLabels[key]}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {preferenceOptions[key].map((option) => {
                          const selected =
                            learningPreferences[key].includes(option)
                          return (
                            <button
                              key={`${key}-${option}`}
                              type="button"
                              onClick={() => togglePreference(key, option)}
                              className="rounded-full px-3 py-1.5 text-sm transition-all duration-300"
                              style={{
                                backgroundColor: selected ? '#4338ca' : '#fff',
                                color: selected ? '#fff' : '#525252',
                                border: selected
                                  ? '1.5px solid #4338ca'
                                  : '1.5px solid #e5e5e5',
                                transitionTimingFunction: 'var(--ease-premium)',
                              }}
                            >
                              {option}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <label className="block space-y-2 text-sm">
                  <span className="oi-mono-label text-neutral-500">
                    Structure preference{' '}
                    <span className="normal-case tracking-normal text-neutral-400">
                      (optional)
                    </span>
                  </span>
                  <textarea
                    className="h-20 w-full resize-none rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 text-sm leading-relaxed outline-none transition-all duration-300 placeholder:text-neutral-300 focus:border-[#4338ca]/40 focus:shadow-[0_0_0_3px_rgba(67,56,202,0.08)]"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    value={learningPreferences.structurePreference ?? ''}
                    onChange={(event) =>
                      setLearningPreferences((previous) => ({
                        ...previous,
                        structurePreference: event.target.value,
                      }))
                    }
                    placeholder="e.g. short modules, strong progression, recap at end of each topic"
                  />
                </label>

                <label className="block space-y-2 text-sm">
                  <span className="oi-mono-label text-neutral-500">
                    Custom instructions{' '}
                    <span className="normal-case tracking-normal text-neutral-400">
                      (optional)
                    </span>
                  </span>
                  <textarea
                    className="h-20 w-full resize-none rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 text-sm leading-relaxed outline-none transition-all duration-300 placeholder:text-neutral-300 focus:border-[#4338ca]/40 focus:shadow-[0_0_0_3px_rgba(67,56,202,0.08)]"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    value={learningPreferences.customNotes ?? ''}
                    onChange={(event) =>
                      setLearningPreferences((previous) => ({
                        ...previous,
                        customNotes: event.target.value,
                      }))
                    }
                    placeholder="Any custom style or constraints for this course"
                  />
                </label>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-full bg-[#4338ca] px-6 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-white transition-all duration-300 hover:bg-[#3730a3] hover:shadow-[0_4px_16px_-4px_rgba(67,56,202,0.4)] disabled:opacity-50"
                    style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    onClick={async () => {
                      const ok = await handleBuildProfile()
                      if (ok) {
                        setStep('review')
                      }
                    }}
                    disabled={status === 'building-profile'}
                  >
                    {status === 'building-profile' ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Building profile...
                      </span>
                    ) : (
                      <>
                        Continue to review
                        <svg
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          viewBox="0 0 14 14"
                        >
                          <path d="M5.5 3.5L9 7l-3.5 3.5" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            {step === 'review' ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-3xl font-bold leading-[1] text-[#171717]">
                      Review &amp; generate
                    </h2>
                    <p className="mt-2 text-sm text-neutral-500">
                      Confirm your profile, then launch the multi-agent
                      pipeline.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-full border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-neutral-500 transition hover:border-neutral-300"
                    onClick={() => setStep('preferences')}
                  >
                    Edit prefs
                  </button>
                </div>

                {/* Generation in-progress overlay */}
                {status === 'running' ? (
                  <div className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-8 text-center">
                    {/* Animated background shimmer */}
                    <div
                      className="absolute inset-0 opacity-30"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent 25%, rgba(67,56,202,0.08) 50%, transparent 75%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 2s linear infinite',
                      }}
                    />
                    <div className="relative">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#4338ca]">
                        <svg
                          className="h-6 w-6 animate-spin text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      </div>
                      <h3 className="font-serif text-xl font-bold text-[#171717]">
                        Generating your course
                      </h3>
                      <p className="mt-2 text-sm text-neutral-500">
                        The multi-agent pipeline is running — planning topics,
                        writing scripts, synthesizing audio, and building visual
                        scenes.
                      </p>
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                        {[
                          { name: 'Planner', detail: 'Structuring topics' },
                          { name: 'Writer', detail: 'Drafting scripts' },
                          { name: 'Translator', detail: 'Localizing text' },
                          { name: 'TTS', detail: 'Synthesizing voice' },
                          { name: 'Timer', detail: 'Syncing cues' },
                          { name: 'Scene', detail: 'Building visuals' },
                        ].map((agent, i) => {
                          const isDone = i < activeStageIndex
                          const isActive = i === activeStageIndex
                          return (
                            <span
                              key={agent.name}
                              title={agent.detail}
                              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors duration-500 ${
                                isDone
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : isActive
                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                    : 'border-indigo-100 bg-white text-indigo-300'
                              }`}
                              style={{
                                animation: `fade-in 600ms var(--ease-premium) ${i * 150}ms both`,
                              }}
                            >
                              {isDone ? (
                                <svg
                                  className="h-2.5 w-2.5"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <path d="M16.7 5.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0L3.3 9.5a1 1 0 111.4-1.4l3.9 3.9 6.7-6.7a1 1 0 011.4 0z" />
                                </svg>
                              ) : isActive ? (
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />
                              ) : null}
                              {agent.name}
                            </span>
                          )
                        })}
                      </div>
                      <p
                        className="mt-3 text-xs text-neutral-400"
                        aria-live="polite"
                      >
                        Estimated progress — actual stage timing varies with
                        topic count and model load.
                      </p>
                    </div>
                  </div>
                ) : profilePreview ? (
                  <div className="space-y-4 rounded-2xl border border-[#e5e5e5] bg-white p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor:
                            profilePreview.learnerLevel === 'beginner'
                              ? '#fef3c7'
                              : profilePreview.learnerLevel === 'intermediate'
                                ? '#dbeafe'
                                : profilePreview.learnerLevel === 'advanced'
                                  ? '#d1fae5'
                                  : '#f3e8ff',
                          color:
                            profilePreview.learnerLevel === 'beginner'
                              ? '#92400e'
                              : profilePreview.learnerLevel === 'intermediate'
                                ? '#1e40af'
                                : profilePreview.learnerLevel === 'advanced'
                                  ? '#065f46'
                                  : '#6b21a8',
                        }}
                      >
                        {profilePreview.learnerLevel}
                      </span>
                      <span className="text-sm text-neutral-500">
                        {(profilePreview.confidenceScore * 100).toFixed(0)}%
                        confidence
                      </span>
                      <span className="text-sm text-neutral-500">
                        {(profilePreview.diagnosticAccuracy * 100).toFixed(0)}%
                        accuracy
                      </span>
                    </div>

                    <p className="text-sm leading-relaxed text-neutral-700">
                      {profilePreview.profileSummary}
                    </p>

                    {draftCourseSummary ? (
                      <div className="rounded-xl border border-[#e5e5e5] bg-neutral-50 p-4">
                        <p className="oi-mono-label text-neutral-500">
                          Course summary
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                          {draftCourseSummary}
                        </p>
                      </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-3">
                      {(
                        [
                          {
                            label: 'Strengths',
                            items: profilePreview.strengths,
                            color: '#059669',
                          },
                          {
                            label: 'Gaps',
                            items: profilePreview.gaps,
                            color: '#dc2626',
                          },
                          {
                            label: 'Notes',
                            items: profilePreview.generatorNotes,
                            color: '#4338ca',
                          },
                        ] as const
                      ).map((section) => (
                        <div
                          key={section.label}
                          className="rounded-xl border border-[#e5e5e5] bg-neutral-50/50 p-3"
                        >
                          <p
                            className="oi-mono-label"
                            style={{ color: section.color }}
                          >
                            {section.label}
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-neutral-600">
                            {section.items.map((item) => (
                              <li
                                key={item}
                                className="flex items-start gap-1.5"
                              >
                                <span
                                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full"
                                  style={{ backgroundColor: section.color }}
                                />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : status === 'building-profile' ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e5e5e5] bg-neutral-50 py-12">
                    <div className="mb-3 h-8 w-8 animate-spin rounded-full border-3 border-neutral-200 border-t-[#4338ca]" />
                    <p className="text-sm text-neutral-500">
                      Building your learner profile...
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e5e5e5] bg-neutral-50 py-12">
                    <p className="text-sm text-neutral-500">
                      Profile not ready yet.
                    </p>
                    <button
                      type="button"
                      className="mt-3 rounded-full border border-[#e5e5e5] bg-white px-4 py-2 text-sm transition hover:border-neutral-300"
                      onClick={() => void handleBuildProfile()}
                    >
                      Build profile
                    </button>
                  </div>
                )}

                {status !== 'running' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="rounded-full border border-[#e5e5e5] bg-white px-4 py-2 text-sm transition hover:border-neutral-300"
                      onClick={() => void handleBuildProfile()}
                      disabled={status === 'building-profile'}
                    >
                      Refresh profile
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-full bg-[#4338ca] px-7 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-white transition-all duration-300 hover:bg-[#3730a3] hover:shadow-[0_4px_16px_-4px_rgba(67,56,202,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        transitionTimingFunction: 'var(--ease-premium)',
                      }}
                      onClick={() => void handleGenerateCourse()}
                      disabled={
                        !profilePreview || status === 'building-profile'
                      }
                    >
                      Generate course
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        viewBox="0 0 14 14"
                      >
                        <path d="M5.5 3.5L9 7l-3.5 3.5" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {error ? (
              <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:h-fit">
            <section className="rounded-2xl border border-[#e5e5e5] bg-white/90 p-4 shadow-[0_16px_50px_-35px_rgba(23,23,23,0.35)]">
              <h3 className="font-serif text-xl font-bold text-[#171717]">
                Current run
              </h3>
              <p className="mt-2 text-sm text-neutral-600">{statusLabel}</p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-neutral-500">Topic</dt>
                  <dd className="max-w-[70%] truncate text-right text-neutral-900">
                    {courseTopic || '-'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-neutral-500">Step</dt>
                  <dd className="font-medium text-neutral-900">
                    {stepLabels[step]}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-neutral-500">Questions answered</dt>
                  <dd className="font-medium text-neutral-900">
                    {diagnosticStats.answeredCount}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-neutral-500">Last generated topics</dt>
                  <dd className="font-medium text-neutral-900">
                    {createdTopics}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-neutral-500">Duration</dt>
                  <dd className="font-medium text-neutral-900">
                    {totalDurationMs
                      ? `${Math.round(totalDurationMs / 1000)} sec`
                      : '-'}
                  </dd>
                </div>
              </dl>
              {draftCourseSummary ? (
                <div className="mt-4 rounded-xl border border-[#e5e5e5] bg-neutral-50 p-3">
                  <p className="oi-mono-label text-neutral-500">
                    Draft summary
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-700">
                    {draftCourseSummary}
                  </p>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-[#e5e5e5] bg-white/90 p-4 shadow-[0_16px_50px_-35px_rgba(23,23,23,0.35)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-serif text-xl font-bold text-[#171717]">
                  Saved courses
                </h3>
                <span className="rounded-full border border-[#e5e5e5] px-2 py-0.5 text-[11px] text-neutral-500">
                  {lessonHistory.length}
                </span>
              </div>

              <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                {lessonHistory.map((lesson) => (
                  <button
                    key={lesson._id}
                    type="button"
                    className="w-full rounded-xl border border-[#e5e5e5] p-3 text-left transition hover:border-neutral-300 hover:bg-neutral-50"
                    onClick={() => void handleLoadLesson(lesson._id)}
                  >
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {lesson.title}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                      {lesson.language} • {lesson.status}
                    </p>
                  </button>
                ))}
                {lessonHistory.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No saved courses yet.
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                className="mt-3 w-full rounded-full border border-[#e5e5e5] bg-white px-3 py-2 text-sm transition hover:border-neutral-300"
                onClick={() => void refreshLessonList()}
              >
                Refresh saved courses
              </button>
            </section>
          </aside>
        </div>
      </section>

      {bundle ? (
        <section className="mx-auto w-full max-w-7xl px-6 pb-12">
          <div className="mb-4 rounded-2xl border border-[#e5e5e5] bg-white/90 p-4 shadow-[0_16px_50px_-35px_rgba(23,23,23,0.35)]">
            <h2 className="font-serif text-2xl font-bold text-[#171717]">
              Generated course
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              {bundle.lesson.title} • {bundle.lesson.language}
            </p>
            {bundle.courseProfile ? (
              <>
                <p className="mt-2 text-sm text-neutral-700">
                  Profile: {bundle.courseProfile.learnerLevel} • Confidence{' '}
                  {(bundle.courseProfile.confidenceScore * 100).toFixed(0)}% •{' '}
                  {bundle.courseProfile.profileSummary}
                </p>
                <p className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                  {bundle.courseProfile.courseSummary}
                </p>
              </>
            ) : null}
          </div>
          <LessonPlayer bundle={bundle} onBack={() => setBundle(null)} />
        </section>
      ) : null}
    </main>
  )
}
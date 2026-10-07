import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { DiagnosticAnswerInput } from '@/lib/pipeline/types'
import {
  buildCourseProfileServerFn,
  getVoicePreviewServerFn,
} from '@/lib/pipeline/server'
import { getCurrentUserServerFn, signOutServerFn } from '@/lib/auth/server'

export const Route = createFileRoute('/')({ component: LandingPage })

/* ─── Accordion Data ─── */
const capabilities = [
  {
    title: 'Adaptive Diagnostics',
    description:
      'AI-generated MCQs calibrated to your topic. Confidence scoring analyzes concept coverage, difficulty spread, and accuracy separation to build a precise learner profile.',
    tags: [
      '[Questionnaire Agent]',
      '[Confidence Scoring]',
      '[Concept Mapping]',
    ],
  },
  {
    title: 'Personalized Generation',
    description:
      'A multi-agent pipeline transforms your profile into a structured course. Planner, Topic, Translation, and Scene agents work in parallel with retry resilience.',
    tags: [
      '[Multi-Agent Pipeline]',
      '[Dynamic Components]',
      '[Parallel Execution]',
    ],
  },
  {
    title: 'Voice Synthesis',
    description:
      'Sarvam AI Bulbul v3 synthesizes natural speech in 11 Indian languages. Each topic segment is narrated and time-synced to interactive visual scenes.',
    tags: ['[Sarvam TTS]', '[11 Languages]', '[Audio Sync]'],
  },
  {
    title: 'Interactive Scenes',
    description:
      'Every lesson features live HTML scenes with animations, interactive elements, and timeline-synchronized visual cues that respond to the narration in real time.',
    tags: ['[HTML Scenes]', '[Timeline Cues]', '[Live Interactions]'],
  },
]

const differentiators = [
  {
    num: '01',
    title: 'Most AI courses are English-only',
    body: 'Even the "multilingual" ones usually bolt machine-translated captions onto English audio, as an afterthought — the personalization underneath still assumes an English-first learner.',
  },
  {
    num: '02',
    title: 'CurriculumOS narrates natively',
    body: "Every lesson is generated as first-class audio in the learner's own language via Sarvam AI's Bulbul v3 engine — Hindi, Tamil, Telugu, and 8 more — not subtitles laid over a translated script.",
  },
  {
    num: '03',
    title: 'Personalized before it\u2019s generated',
    body: 'A short diagnostic runs first and shapes the course plan itself, so a beginner and an advanced learner asking about the same topic, in the same language, get genuinely different lessons.',
  },
]

const sampleLessons = [
  { topic: 'Recursion', language: 'Hindi', native: 'हिन्दी', bg: 'bg-indigo-50' },
  { topic: 'Photosynthesis', language: 'Tamil', native: 'தமிழ்', bg: 'bg-emerald-50' },
  { topic: 'Newton\u2019s Laws', language: 'Telugu', native: 'తెలుగు', bg: 'bg-amber-50' },
  { topic: 'Supply & Demand', language: 'Bengali', native: 'বাংলা', bg: 'bg-rose-50' },
]

/* ─── Voice preview (Phase 2, item 6) ───
 * Real call to the Sarvam TTS pipeline — not a canned audio file. If
 * SARVAM_API_KEY isn't configured, the server function throws a clear
 * message which is surfaced inline instead of a silent failure.
 */
function VoicePreviewButton({ language }: { language: string }) {
  const getPreview = useServerFn(getVoicePreviewServerFn)
  const [state, setState] = React.useState<
    'idle' | 'loading' | 'playing' | 'error'
  >('idle')
  const [errorMsg, setErrorMsg] = React.useState('')
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  async function handleClick() {
    if (state === 'playing') {
      audioRef.current?.pause()
      setState('idle')
      return
    }
    setState('loading')
    setErrorMsg('')
    try {
      const result = await getPreview({ data: { language } })
      const src = result.base64Audio
        ? `data:${result.mimeType};base64,${result.base64Audio}`
        : result.externalAudioUrl
      if (!src) throw new Error('No audio returned')
      const audio = new Audio(src)
      audioRef.current = audio
      audio.onended = () => setState('idle')
      audio.onerror = () => {
        setState('error')
        setErrorMsg('Playback failed.')
      }
      await audio.play()
      setState('playing')
    } catch (err) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Preview failed.')
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label={`Play ${language} voice sample`}
        className="flex items-center gap-1.5 rounded-full border border-[#e5e5e5] bg-white px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500 transition hover:border-[#4338ca]/40 hover:text-[#4338ca] disabled:opacity-50"
        disabled={state === 'loading'}
      >
        {state === 'loading' ? (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-300 border-t-[#4338ca]" />
        ) : state === 'playing' ? (
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="3" height="9" rx="0.5" />
            <rect x="6" y="0" width="3" height="9" rx="0.5" />
          </svg>
        ) : (
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M0 0l9 4.5L0 9V0z" />
          </svg>
        )}
        {language}
      </button>
      {state === 'error' && (
        <span className="max-w-[180px] text-[9px] leading-tight text-red-500">
          {errorMsg}
        </span>
      )}
    </span>
  )
}

/* ─── Split-screen personalization demo (Phase 2, item 7) ───
 * Calls the real ProfilerAgent (buildCourseProfileServerFn) twice with
 * the same topic but two different diagnostic answer sets, to make the
 * "adaptive" claim inspectable instead of asserted. Works even without
 * GOOGLE_GENERATIVE_AI_API_KEY configured — buildCourseProfile has a
 * deterministic fallback path (see src/lib/pipeline/agents.ts) so this
 * demo degrades gracefully rather than failing outright.
 */
const DEMO_TOPIC = 'Binary search trees'
const DEMO_PREFS = {
  pace: ['moderate'],
  depth: ['conceptual'],
  format: ['visual examples'],
  interactivity: ['quizzes'],
  assessment: ['short checks'],
}

function buildDemoAnswers(
  correctFraction: number,
): Array<DiagnosticAnswerInput> {
  const concepts = [
    'Tree traversal',
    'Insertion order',
    'Balancing',
    'Time complexity',
    'Deletion cases',
    'Successor lookup',
  ]
  return concepts.map((concept, i) => {
    const isCorrect = i < Math.round(concepts.length * correctFraction)
    return {
      questionId: `demo-${i}`,
      questionPrompt: `Question about ${concept.toLowerCase()}`,
      concept,
      difficulty: 'intermediate' as const,
      selectedOptionIndex: isCorrect ? 0 : 1,
      correctOptionIndex: 0,
    }
  })
}

function AdaptiveDemo() {
  const buildProfile = useServerFn(buildCourseProfileServerFn)
  const [state, setState] = React.useState<
    'idle' | 'loading' | 'done' | 'error'
  >('idle')
  const [errorMsg, setErrorMsg] = React.useState('')
  const [results, setResults] = React.useState<{
    beginner: Awaited<ReturnType<typeof buildProfile>> | null
    advanced: Awaited<ReturnType<typeof buildProfile>> | null
  }>({ beginner: null, advanced: null })

  async function run() {
    setState('loading')
    setErrorMsg('')
    try {
      const [beginner, advanced] = await Promise.all([
        buildProfile({
          data: {
            topic: DEMO_TOPIC,
            targetLanguage: 'english',
            diagnosticAnswers: buildDemoAnswers(0.15),
            learningPreferences: DEMO_PREFS,
          },
        }),
        buildProfile({
          data: {
            topic: DEMO_TOPIC,
            targetLanguage: 'english',
            diagnosticAnswers: buildDemoAnswers(0.9),
            learningPreferences: DEMO_PREFS,
          },
        }),
      ])
      setResults({ beginner, advanced })
      setState('done')
    } catch (err) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Comparison failed.')
    }
  }

  return (
    <div>
      {state === 'idle' && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#e5e5e5] bg-white/60 py-14 text-center">
          <p className="max-w-md text-sm text-neutral-500">
            Same topic — <strong className="text-[#171717]">{DEMO_TOPIC}</strong> —
            run through the real ProfilerAgent with two different diagnostic
            answer sets. See how the resulting profile changes.
          </p>
          <button
            type="button"
            onClick={() => void run()}
            className="rounded-full bg-[#4338ca] px-6 py-2.5 text-sm text-white transition hover:bg-[#3730a3]"
          >
            Run live comparison
          </button>
        </div>
      )}

      {state === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-14">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-[#4338ca]" />
          <p className="text-sm text-neutral-500">
            Calling ProfilerAgent for both profiles...
          </p>
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="text-sm text-red-500">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void run()}
            className="rounded-full border border-[#e5e5e5] px-5 py-2 text-sm hover:border-neutral-300"
          >
            Try again
          </button>
        </div>
      )}

      {state === 'done' && (
        <div className="grid gap-5 md:grid-cols-2">
          {(
            [
              { label: 'Struggling learner', data: results.beginner },
              { label: 'Confident learner', data: results.advanced },
            ] as const
          ).map((col) => (
            <div
              key={col.label}
              className="rounded-2xl border border-[#e5e5e5] bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <p className="oi-mono-label text-neutral-500">{col.label}</p>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#4338ca]">
                  {col.data?.learnerLevel}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-neutral-700">
                {col.data?.profileSummary}
              </p>
              <div className="mt-4">
                <p className="oi-mono-label text-emerald-600">
                  Generator notes
                </p>
                <ul className="mt-1.5 space-y-1 text-sm text-neutral-600">
                  {col.data?.generatorNotes.map((n) => (
                    <li key={n} className="flex items-start gap-1.5">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Auth nav (sign in / sign up / sign out) ───
 * A single small component so the same auth-state logic isn't duplicated
 * across the landing page, studio, and courses nav bars.
 */
function AuthNav({ dark = true }: { dark?: boolean }) {
  const getCurrentUser = useServerFn(getCurrentUserServerFn)
  const signOut = useServerFn(signOutServerFn)
  const [user, setUser] = React.useState<{ email: string } | null | 'loading'>(
    'loading',
  )

  React.useEffect(() => {
    let cancelled = false
    getCurrentUser()
      .then((u) => {
        if (!cancelled) setUser(u)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [getCurrentUser])

  const linkClass = dark
    ? 'text-white/80 hover:text-white'
    : 'text-neutral-500 hover:text-[#171717]'

  if (user === 'loading') {
    return <span className="h-8 w-20" />
  }

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${linkClass}`}>
          {user.email}
        </span>
        <button
          type="button"
          onClick={() => {
            void signOut().then(() => window.location.assign('/'))
          }}
          className={`rounded-full border ${dark ? 'border-white/20 text-white hover:border-white/50' : 'border-[#e5e5e5] text-[#171717] hover:border-neutral-300'} px-5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.3em] transition-all`}
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        to="/sign-in"
        className={`font-mono text-[10px] font-medium uppercase tracking-[0.3em] ${linkClass}`}
      >
        Sign in
      </Link>
      <Link
        to="/sign-up"
        className={`rounded-full border ${dark ? 'border-white/20 text-white hover:border-white/50' : 'border-[#e5e5e5] text-[#171717] hover:border-neutral-300'} px-5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.3em] transition-all`}
      >
        Sign up
      </Link>
    </div>
  )
}

function LandingPage() {
  const [openAccordion, setOpenAccordion] = React.useState<number | null>(0)
  const [scrollY, setScrollY] = React.useState(0)

  React.useEffect(() => {
    function onScroll() {
      setScrollY(window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const headerOpacity = Math.min(1, scrollY / 200)

  return (
    <div className="relative" style={{ backgroundColor: '#fcfbf9' }}>
      {/* ═══════════════════════════════════════════ */}
      {/* HEADER — mix-blend-difference for visibility */}
      {/* ═══════════════════════════════════════════ */}
      <header
        className="fixed left-0 right-0 top-0 z-[100]"
        style={{ mixBlendMode: 'difference' }}
      >
        <div
          className="absolute inset-0 bg-white/5 backdrop-blur-md transition-opacity duration-500"
          style={{ opacity: headerOpacity }}
        />
        <div className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-10">
          {/* Logo */}
          <Link to="/" className="font-serif text-xl italic text-white">
            CurriculumOS
          </Link>

          {/* Center nav */}
          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="#why"
              className="oi-nav-link text-white/70 transition-colors hover:text-white"
            >
              Why us
            </a>
            <a
              href="#capabilities"
              className="oi-nav-link text-white/70 transition-colors hover:text-white"
            >
              Capabilities
            </a>
            <a
              href="#powered"
              className="oi-nav-link text-white/70 transition-colors hover:text-white"
            >
              Engine
            </a>
          </nav>

          {/* Auth */}
          <AuthNav dark />
        </div>
      </header>

      {/* ═══════════════════════════════════════════ */}
      {/* HERO SECTION                               */}
      {/* ═══════════════════════════════════════════ */}
      <section className="oi-hero-section">
        {/* Mesh gradient background */}
        <div className="oi-hero-mesh" aria-hidden="true">
          <div className="oi-hero-mesh-orb oi-hero-mesh-orb-a" />
          <div className="oi-hero-mesh-orb oi-hero-mesh-orb-b" />
        </div>

        {/* Hero text */}
        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-7xl flex-col items-center justify-center px-6 pb-[18vh] pt-36 text-center md:px-10 md:pt-32">
          <p
            className="oi-reveal oi-mono-label text-white/55"
            style={{ animationDelay: '160ms' }}
          >
            Technical courses in your own language
          </p>

          <h1
            className="oi-reveal mt-6 font-serif font-bold leading-[0.85] text-white"
            style={{
              fontSize: 'clamp(3.25rem, 11vw, 12rem)',
              animationDelay: '320ms',
            }}
          >
            Learn it in
            <br />
            <em className="font-normal italic text-indigo-300">your</em> language
          </h1>

          <p
            className="oi-reveal mx-auto mt-8 max-w-2xl text-base leading-[1.5] text-white/60 md:text-lg"
            style={{ animationDelay: '500ms' }}
          >
            Most AI courses only teach in English. CurriculumOS diagnoses what
            you already know, then generates a personalized, narrated lesson
            in Hindi, Tamil, Telugu, or 8 other Indian languages — built for
            learners who think better outside English-only material.
          </p>

          <div
            className="oi-reveal mt-10 flex flex-wrap items-center justify-center gap-4"
            style={{ animationDelay: '680ms' }}
          >
            <Link
              to="/demo"
              className="rounded-full bg-white px-8 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.35em] text-[#171717] transition-all hover:bg-white/90"
              style={{ transitionTimingFunction: 'var(--ease-premium)' }}
            >
              Try live demo
            </Link>
            <Link
              to="/courses"
              className="rounded-full border border-white/25 px-8 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.35em] text-white/75 transition-all hover:border-white/55 hover:text-white"
              style={{ transitionTimingFunction: 'var(--ease-premium)' }}
            >
              View Courses
            </Link>
          </div>
        </div>

        {/* Wave curve transition to cream section */}
        <div className="oi-wave-container">
          <div className="oi-wave-curve" />
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* WHY DIFFERENT                                */}
      {/* ═══════════════════════════════════════════ */}
      <section
        id="why"
        className="relative z-10 py-24"
        style={{ backgroundColor: '#fcfbf9' }}
      >
        <div className="mx-auto max-w-5xl px-6 md:px-10">
          <div className="mb-16 text-center">
            <p className="oi-mono-label text-[#4338ca]">Why we're different</p>
            <h2 className="mt-3 font-serif text-4xl font-bold leading-[0.95] text-[#171717] md:text-6xl">
              Language <em className="font-normal italic">first</em>,
              <br />
              not translated <em className="font-normal italic">after</em>.
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {differentiators.map((d, i) => (
              <div
                key={d.num}
                className="oi-card-hover rounded-2xl border border-[#e5e5e5] bg-white p-7"
                style={{
                  animation: `fade-in 700ms var(--ease-premium) ${i * 150}ms both`,
                }}
              >
                <span className="font-serif text-3xl font-bold italic text-[#4338ca]/25">
                  {d.num}
                </span>
                <h3 className="mt-4 font-serif text-lg font-bold leading-snug text-[#171717]">
                  {d.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-neutral-500">
                  {d.body}
                </p>
              </div>
            ))}
          </div>

          {/* Sample lessons strip — makes "your own language" concrete */}
          <div className="mt-16">
            <p className="oi-mono-label text-center text-neutral-400">
              The same lesson, generated natively in different languages
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              {sampleLessons.map((l, i) => (
                <Link
                  key={l.topic}
                  to="/studio"
                  className={`oi-card-hover group block overflow-hidden rounded-xl border border-[#e5e5e5] ${l.bg} p-5`}
                  style={{
                    transitionTimingFunction: 'var(--ease-premium)',
                    animation: `fade-in 700ms var(--ease-premium) ${500 + i * 120}ms both`,
                  }}
                >
                  <p className="font-serif text-2xl font-bold text-[#171717]/70">
                    {l.native}
                  </p>
                  <p className="mt-3 text-sm font-medium text-[#171717]">
                    {l.topic}
                  </p>
                  <p className="oi-mono-label mt-1 text-neutral-400">
                    {l.language}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* SERVICE ACCORDION — Core Capabilities      */}
      {/* ═══════════════════════════════════════════ */}
      <section
        id="capabilities"
        className="border-t border-[#e5e5e5] py-24"
        style={{ backgroundColor: '#fcfbf9' }}
      >
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <div className="grid gap-16 md:grid-cols-[1fr_1.2fr]">
            {/* Left sticky */}
            <div className="md:sticky md:top-32 md:self-start">
              <p className="oi-mono-label text-[#4338ca]">What powers it</p>
              <h2 className="mt-3 font-serif text-4xl font-bold leading-[0.95] text-[#171717] md:text-5xl">
                Core
                <br />
                <em className="font-normal italic">Capabilities</em>
              </h2>
              <p className="mt-4 max-w-sm text-base leading-relaxed text-neutral-500">
                A nine-agent orchestration pipeline that diagnoses, profiles,
                plans, writes, translates, narrates, times, visualizes, and
                validates your course.
              </p>
              <Link
                to="/studio"
                className="mt-8 inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.2em] text-[#4338ca] transition-colors hover:text-[#3730a3]"
                style={{ transitionTimingFunction: 'var(--ease-premium)' }}
              >
                Start building
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform group-hover:translate-x-1"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
            </div>

            {/* Right accordion */}
            <div className="space-y-0">
              {capabilities.map((cap, index) => {
                const isOpen = openAccordion === index
                return (
                  <div
                    key={cap.title}
                    className="border-t border-[#e5e5e5] py-6 first:border-t-0"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                      onClick={() => setOpenAccordion(isOpen ? null : index)}
                    >
                      <h3
                        className="font-serif text-2xl transition-colors md:text-3xl"
                        style={{
                          color: isOpen ? '#171717' : '#a3a3a3',
                          transitionTimingFunction: 'var(--ease-premium)',
                          transitionDuration: '400ms',
                        }}
                      >
                        {cap.title}
                      </h3>
                      <span
                        className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5e5e5] font-mono text-sm text-neutral-400 transition-all"
                        style={{
                          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                          transitionTimingFunction: 'var(--ease-premium)',
                          transitionDuration: '400ms',
                        }}
                      >
                        +
                      </span>
                    </button>
                    <div
                      className={`oi-accordion-content ${isOpen ? 'expanded' : ''}`}
                    >
                      <p className="mt-4 max-w-lg text-base leading-relaxed text-neutral-600">
                        {cap.description}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {cap.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-[#e5e5e5] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* POWERED BY SARVAM AI                       */}
      {/* ═══════════════════════════════════════════ */}
      <section
        id="powered"
        className="border-t border-[#e5e5e5] py-24"
        style={{ backgroundColor: '#fcfbf9' }}
      >
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <p className="oi-mono-label text-[#4338ca]">Voice Engine</p>
              <h2 className="mt-3 font-serif text-4xl font-bold leading-[0.95] text-[#171717] md:text-5xl">
                Powered by
                <br />
                <em className="font-normal italic">Sarvam AI</em>
              </h2>
              <p className="mt-6 max-w-md text-base leading-relaxed text-neutral-500">
                Every lesson is narrated using Sarvam AI's Bulbul v3
                text-to-speech engine — delivering natural, expressive voice
                synthesis across 11 Indian languages including Hindi, Tamil,
                Telugu, and English.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                {['English', 'Hindi', 'Tamil', 'Telugu'].map((lang) => (
                  <VoicePreviewButton key={lang} language={lang} />
                ))}
                <span className="rounded-full border border-[#4338ca]/20 bg-indigo-50 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-[#4338ca]">
                  +7 More
                </span>
              </div>
              <p className="mt-2 text-xs text-neutral-400">
                Click a language to hear a live sample from the TTS engine.
              </p>
            </div>

            {/* Visual — audio waveform spectrum */}
            <div className="relative flex items-center justify-center">
              <div className="relative h-72 w-full max-w-md md:h-80">
                {/* Background glow */}
                <div
                  className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30"
                  style={{
                    background:
                      'radial-gradient(circle, #4338ca 0%, transparent 70%)',
                    filter: 'blur(50px)',
                    animation: 'pulse-glow 4s ease-in-out infinite',
                  }}
                />

                {/* Waveform bars */}
                <div className="absolute inset-0 flex items-center justify-center gap-[3px]">
                  {Array.from({ length: 32 }, (_, i) => {
                    const center = 15.5
                    const dist = Math.abs(i - center) / center
                    const maxH = 100 * (1 - dist * dist * 0.7)
                    const minH = 8 + Math.random() * 12
                    const delay = i * 60
                    return (
                      <div
                        key={i}
                        className="rounded-full"
                        style={{
                          width: '3px',
                          height: `${minH}%`,
                          background: `linear-gradient(180deg, #4338ca ${Math.round(30 + dist * 40)}%, #7c3aed)`,
                          opacity: 0.25 + (1 - dist) * 0.75,
                          animation: `waveform-bar 1.8s ease-in-out ${delay}ms infinite alternate`,
                          ['--bar-max-h' as string]: `${maxH}%`,
                          ['--bar-min-h' as string]: `${minH}%`,
                        }}
                      />
                    )
                  })}
                </div>

                {/* Horizontal line through center */}
                <div
                  className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#4338ca]/10"
                  style={{
                    animation:
                      'line-draw 1200ms var(--ease-premium) 200ms both',
                    transformOrigin: 'left',
                  }}
                />

                {/* Language labels along bottom curve */}
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-5">
                  {['English', 'Hindi', 'Tamil', 'Telugu'].map((lang, i) => (
                    <span
                      key={lang}
                      className="oi-reveal rounded-full border border-[#4338ca]/15 bg-white/80 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.25em] text-[#4338ca]/70 shadow-sm backdrop-blur-sm"
                      style={{ animationDelay: `${800 + i * 120}ms` }}
                    >
                      {lang}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* ADAPTIVE DEMO — same topic, two profiles    */}
      {/* ═══════════════════════════════════════════ */}
      <section className="border-t border-[#e5e5e5] py-24">
        <div className="mx-auto max-w-5xl px-6 md:px-10">
          <p className="oi-mono-label text-center text-[#4338ca]">
            See it, don&apos;t take our word for it
          </p>
          <h2 className="mt-3 text-center font-serif text-3xl font-bold leading-[1.05] text-[#171717] md:text-4xl">
            One topic. <em className="italic">Two profiles.</em>
          </h2>
          <div className="mt-10">
            <AdaptiveDemo />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* STATS ROW                                  */}
      {/* ═══════════════════════════════════════════ */}
      <section
        className="border-t border-[#e5e5e5]"
        style={{ backgroundColor: '#fcfbf9' }}
      >
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-[#e5e5e5] px-6 md:grid-cols-4 md:px-10">
          {[
            { value: '9', label: 'AI Agents' },
            { value: '11', label: 'Languages' },
            { value: '<2m', label: 'Avg Generation' },
            { value: '100%', label: 'Adaptive' },
          ].map((stat) => (
            <div key={stat.label} className="py-12 text-center">
              <p className="font-serif text-4xl font-bold text-[#171717] md:text-5xl">
                {stat.value}
              </p>
              <p className="oi-mono-label mt-2 text-neutral-400">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* FOOTER — Dark with radial glow             */}
      {/* ═══════════════════════════════════════════ */}
      <footer
        className="relative overflow-hidden bg-[#171717]"
        style={{ borderRadius: '5rem 5rem 0 0' }}
      >
        {/* Radial indigo glow */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 opacity-20"
          style={{
            background: 'radial-gradient(ellipse, #4338ca 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl px-6 pb-8 pt-24 md:px-10">
          {/* Large quote */}
          <h2 className="mx-auto max-w-4xl text-center font-serif text-3xl font-bold leading-[1.1] text-white md:text-5xl">
            Learning shouldn't stop
            <br />
            at a <em className="font-normal italic text-indigo-300">language</em> barrier.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-center text-sm text-white/50">
            Diagnose, personalize, and narrate — natively, in the language
            you think in.
          </p>

          {/* CTA */}
          <div className="mt-12 flex justify-center">
            <Link
              to="/studio"
              className="rounded-full bg-[#4338ca] px-10 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-white transition-all hover:bg-[#3730a3]"
              style={{
                animation: 'pulse-glow 3s var(--ease-premium) infinite',
                transitionTimingFunction: 'var(--ease-premium)',
              }}
            >
              Start Creating
            </Link>
          </div>

          {/* Grid */}
          <div className="mt-20 grid gap-10 border-t border-white/10 pt-10 md:grid-cols-3">
            {/* Col 1 */}
            <div>
              <p className="oi-mono-label text-white/30">Platform</p>
              <p className="mt-3 font-serif text-lg italic text-white/80">
                CurriculumOS
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/40">
                Adaptive course generation powered by multi-agent AI
                orchestration and Sarvam voice synthesis.
              </p>
            </div>

            {/* Col 2 */}
            <div>
              <p className="oi-mono-label text-white/30">Navigation</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link
                    to="/studio"
                    className="text-sm text-white/50 transition-colors hover:text-white"
                  >
                    Course Studio
                  </Link>
                </li>
                <li>
                  <Link
                    to="/courses"
                    className="text-sm text-white/50 transition-colors hover:text-white"
                  >
                    My Courses
                  </Link>
                </li>
                <li>
                  <a
                    href="#capabilities"
                    className="text-sm text-white/50 transition-colors hover:text-white"
                  >
                    Capabilities
                  </a>
                </li>
              </ul>
            </div>

            {/* Col 3 */}
            <div>
              <p className="oi-mono-label text-white/30">Built With</p>
              <ul className="mt-3 space-y-2">
                <li className="text-sm text-white/50">
                  Sarvam AI &middot; Bulbul v3 TTS
                </li>
                <li className="text-sm text-white/50">
                  Google Gemini &middot; Multi-Agent
                </li>
                <li className="text-sm text-white/50">
                  Convex &middot; Real-time Backend
                </li>
                <li className="text-sm text-white/50">
                  TanStack Start &middot; React 19
                </li>
              </ul>
            </div>
          </div>

          {/* Copyright */}
          <div className="mt-12 border-t border-white/10 pt-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/20">
              &copy; {new Date().getFullYear()} CurriculumOS &middot; Powered by
              Sarvam AI
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
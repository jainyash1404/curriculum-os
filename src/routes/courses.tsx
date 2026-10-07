import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { LessonBundle } from '@/lib/pipeline/types'
import {
  deleteLessonServerFn,
  getLessonBundleServerFn,
  listLessonsServerFn,
} from '@/lib/pipeline/server'
import { getCurrentUserServerFn } from '@/lib/auth/server'
import { LessonPlayer } from '@/components/lesson-player'

export const Route = createFileRoute('/courses')({ component: CoursesPage })

type LessonListItem = {
  _id: string
  title: string
  language: string
  status: string
}

const categoryColors: Record<string, string> = {
  english: 'bg-indigo-50',
  hindi: 'bg-amber-50',
  tamil: 'bg-emerald-50',
  telugu: 'bg-rose-50',
}

/**
 * Deterministic, topic-derived thumbnail — no image-generation API in this
 * stack (only text/TTS), and adding a paid image model is a bigger scope
 * change than this feature warrants. Instead: hash the course title into a
 * stable palette + shape layout, so every course gets a unique, consistent
 * visual automatically, with no extra generation step or API cost.
 */
const THUMBNAIL_PALETTES = [
  { bg: '#eef2ff', accent: '#4338ca', accent2: '#818cf8' },
  { bg: '#fef3e2', accent: '#c2620a', accent2: '#fbbf24' },
  { bg: '#ecfdf5', accent: '#047857', accent2: '#6ee7b7' },
  { bg: '#fdf2f8', accent: '#be185d', accent2: '#f9a8d4' },
  { bg: '#f0f9ff', accent: '#0369a1', accent2: '#7dd3fc' },
  { bg: '#faf5ff', accent: '#7e22ce', accent2: '#d8b4fe' },
]

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function CourseThumbnail({ title }: { title: string }) {
  const hash = hashString(title)
  const palette = THUMBNAIL_PALETTES[hash % THUMBNAIL_PALETTES.length]
  const initial = title.trim().charAt(0).toUpperCase() || '?'
  // Derive a few "random but stable" shape positions from the hash so the
  // same title always renders the same thumbnail.
  const cx1 = 20 + (hash % 40)
  const cy1 = 15 + ((hash >> 4) % 30)
  const cx2 = 60 + ((hash >> 8) % 30)
  const cy2 = 55 + ((hash >> 12) % 30)
  const r1 = 22 + (hash % 14)
  const r2 = 14 + ((hash >> 6) % 10)

  return (
    <svg
      viewBox="0 0 100 75"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Thumbnail for ${title}`}
    >
      <rect width="100" height="75" fill={palette.bg} />
      <circle cx={cx1} cy={cy1} r={r1} fill={palette.accent2} opacity="0.35" />
      <circle cx={cx2} cy={cy2} r={r2} fill={palette.accent} opacity="0.5" />
      <text
        x="50"
        y="44"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Georgia, serif"
        fontStyle="italic"
        fontWeight="700"
        fontSize="30"
        fill={palette.accent}
        opacity="0.9"
      >
        {initial}
      </text>
    </svg>
  )
}

function CoursesPage() {
  const getBundle = useServerFn(getLessonBundleServerFn)
  const listLessons = useServerFn(listLessonsServerFn)
  const deleteLessonFn = useServerFn(deleteLessonServerFn)
  const getCurrentUser = useServerFn(getCurrentUserServerFn)

  const [lessons, setLessons] = React.useState<Array<LessonListItem>>([])
  const [activeBundle, setActiveBundle] = React.useState<LessonBundle | null>(
    null,
  )
  const [loading, setLoading] = React.useState(true)
  const [loadingId, setLoadingId] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [playingTopicIdx, setPlayingTopicIdx] = React.useState<number | null>(
    null,
  )
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    void (async () => {
      const user = await getCurrentUser().catch(() => null)
      setSignedIn(Boolean(user))
      const items = (await listLessons({
        data: { limit: 50 },
      })) as Array<LessonListItem>
      setLessons(items)
      setLoading(false)
    })()
  }, [listLessons, getCurrentUser])

  async function handleOpen(lessonId: string) {
    setLoadingId(lessonId)
    const bundle = await getBundle({ data: { lessonId } })
    setActiveBundle(bundle)
    setLoadingId(null)
  }

  async function handleDelete(lessonId: string, title: string) {
    const confirmed = window.confirm(
      `Delete "${title}"? This permanently removes it — audio, scripts, and scenes — from the database. This can't be undone.`,
    )
    if (!confirmed) return

    setDeletingId(lessonId)
    setDeleteError(null)
    try {
      await deleteLessonFn({ data: { lessonId } })
      setLessons((prev) => prev.filter((l) => l._id !== lessonId))
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete course.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  /* ── Full-screen player ── */
  if (activeBundle && playingTopicIdx !== null) {
    return (
      <LessonPlayer
        bundle={activeBundle}
        initialTopicIndex={playingTopicIdx}
        onBack={() => setPlayingTopicIdx(null)}
      />
    )
  }

  /* ── Topic list ── */
  if (activeBundle) {
    return (
      <main className="min-h-screen" style={{ backgroundColor: '#fcfbf9' }}>
        <nav className="sticky top-0 z-50 border-b border-[#e5e5e5] bg-[#fcfbf9]/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
            <button
              type="button"
              onClick={() => setActiveBundle(null)}
              className="flex items-center gap-2 text-neutral-500 transition-colors hover:text-[#171717]"
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 16 16"
              >
                <path d="M10 12L6 8l4-4" />
              </svg>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
                Back to courses
              </span>
            </button>
          </div>
        </nav>

        <section className="mx-auto max-w-4xl px-6 py-12">
          <div className="oi-reveal">
            <p className="oi-mono-label text-[#4338ca]">
              {activeBundle.lesson.language}
            </p>
            <h1 className="mt-3 font-serif text-4xl font-bold text-[#171717]">
              {activeBundle.lesson.title}
            </h1>
            {activeBundle.courseProfile ? (
              <p className="mt-3 max-w-xl text-base leading-relaxed text-neutral-500">
                {activeBundle.courseProfile.courseSummary}
              </p>
            ) : null}
          </div>

          <div
            className="mt-8 h-px bg-[#e5e5e5]"
            style={{
              animation: 'line-draw 1200ms var(--ease-premium) 400ms both',
              transformOrigin: 'left',
            }}
          />

          <div className="mt-8 space-y-3">
            {activeBundle.topics.map((t, i) => (
              <button
                type="button"
                key={t.topic._id}
                onClick={() => setPlayingTopicIdx(i)}
                className="group flex w-full items-center gap-5 rounded-xl border border-[#e5e5e5] bg-white p-5 text-left transition-all hover:border-[#4338ca]/20 hover:shadow-md oi-reveal"
                style={{
                  animationDelay: `${i * 80}ms`,
                  transitionTimingFunction: 'var(--ease-premium)',
                }}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-mono text-sm font-medium text-neutral-400 transition-colors group-hover:bg-indigo-50 group-hover:text-[#4338ca]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-serif text-lg font-bold text-[#171717]">
                    {t.topic.title}
                  </h3>
                  {t.topic.brief ? (
                    <p className="mt-1 truncate text-sm text-neutral-500">
                      {t.topic.brief}
                    </p>
                  ) : null}
                </div>
                <svg
                  className="shrink-0 text-neutral-300 transition-colors group-hover:text-[#4338ca]"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 20 20"
                >
                  <path d="M7.5 5l5 5-5 5" />
                </svg>
              </button>
            ))}
          </div>
        </section>
      </main>
    )
  }

  /* ── Course list ── */
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#fcfbf9' }}>
      {/* Header */}
      <nav className="sticky top-0 z-50 border-b border-[#e5e5e5] bg-[#fcfbf9]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="font-serif text-lg italic text-[#171717]">
            CurriculumOS
          </Link>
          <div className="flex items-center gap-6">
            <Link
              to="/studio"
              className="oi-nav-link text-neutral-500 hover:text-[#171717]"
            >
              Create
            </Link>
            <Link
              to="/studio"
              className="rounded-full bg-[#4338ca] px-5 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-white transition-all hover:bg-[#3730a3]"
              style={{ transitionTimingFunction: 'var(--ease-premium)' }}
            >
              New Course
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero area */}
      <section className="mx-auto max-w-7xl px-6 pb-6 pt-16">
        <div className="oi-reveal">
          <p className="oi-mono-label text-[#4338ca]">Your Library</p>
          <h1 className="mt-3 font-serif text-5xl font-bold leading-[0.9] text-[#171717] md:text-7xl">
            My
            <br />
            <em className="font-normal italic">Courses</em>
          </h1>
          <p className="mt-4 max-w-md text-base text-neutral-500">
            Courses tied to your account — personalized to your learning
            profile, private to you.
          </p>
        </div>
      </section>

      {/* Divider line */}
      <div className="mx-auto max-w-7xl px-6">
        <div
          className="h-px bg-[#e5e5e5]"
          style={{
            animation: 'line-draw 1200ms var(--ease-premium) 400ms both',
            transformOrigin: 'left',
          }}
        />
      </div>

      {/* Grid */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="oi-mono-label animate-pulse text-neutral-400">
              Loading courses...
            </p>
          </div>
        ) : lessons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            {signedIn === false ? (
              <>
                <p className="font-serif text-2xl italic text-neutral-300">
                  Sign in to see your courses
                </p>
                <p className="mt-3 text-sm text-neutral-400">
                  Courses are tied to your account.
                </p>
                <div className="mt-6 flex gap-3">
                  <Link
                    to="/sign-in"
                    className="rounded-full bg-[#4338ca] px-6 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-white transition-all hover:bg-[#3730a3]"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/demo"
                    className="rounded-full border border-[#e5e5e5] px-6 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-[#171717] transition-all hover:border-neutral-300"
                  >
                    Try live demo
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="font-serif text-2xl italic text-neutral-300">
                  No courses yet
                </p>
                <p className="mt-3 text-sm text-neutral-400">
                  Create your first adaptive course in the studio.
                </p>
                <Link
                  to="/studio"
                  className="mt-6 rounded-full bg-[#4338ca] px-6 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-white transition-all hover:bg-[#3730a3]"
                  style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                >
                  Go to Studio
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            {deleteError && (
              <div
                role="alert"
                className="md:col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {deleteError}
              </div>
            )}
            {lessons.map((lesson, index) => {
              const bgColor =
                categoryColors[lesson.language.toLowerCase()] ?? 'bg-indigo-50'
              const isLoading = loadingId === lesson._id
              const isDeleting = deletingId === lesson._id
              const staggerDelay = Math.min(index * 100, 700)

              return (
                <div
                  key={lesson._id}
                  className={`group relative overflow-hidden rounded-2xl border border-[#e5e5e5] transition-all oi-card-hover oi-reveal ${isDeleting ? 'opacity-40' : ''}`}
                  style={{
                    animationDelay: `${staggerDelay}ms`,
                    transitionTimingFunction: 'var(--ease-premium)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void handleOpen(lesson._id)}
                    className="block w-full text-left"
                    disabled={isLoading || isDeleting}
                  >
                    {/* Card background */}
                    <div
                      className={`aspect-[4/3] ${bgColor} relative flex items-center justify-center overflow-hidden transition-transform duration-700`}
                      style={{ transitionTimingFunction: 'var(--ease-premium)' }}
                    >
                      <CourseThumbnail title={lesson.title} />

                      <div className="oi-action-pill absolute bottom-4 right-4 rounded-full bg-white px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#171717] shadow-sm">
                        {isLoading ? 'Loading...' : 'View'}
                      </div>
                    </div>

                    {/* Card metadata */}
                    <div className="border-t border-[#e5e5e5] bg-white p-5">
                      <h3 className="truncate pr-8 font-serif text-lg font-bold text-[#171717]">
                        {lesson.title}
                      </h3>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="oi-mono-label text-neutral-400">
                          {lesson.language}
                        </span>
                        <span
                          className={`oi-mono-label ${
                            lesson.status === 'ready'
                              ? 'text-emerald-600'
                              : lesson.status === 'failed'
                                ? 'text-red-500'
                                : 'text-neutral-400'
                          }`}
                        >
                          {lesson.status}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Delete — sibling to the open-button, not nested inside
                      it (nested <button> elements are invalid HTML). */}
                  <button
                    type="button"
                    onClick={() => void handleDelete(lesson._id, lesson.title)}
                    disabled={isDeleting}
                    aria-label={`Delete ${lesson.title}`}
                    title="Delete course"
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-500 opacity-0 shadow-sm backdrop-blur transition-opacity duration-200 hover:bg-white hover:text-red-600 disabled:opacity-100 group-hover:opacity-100"
                  >
                    {isDeleting ? (
                      <span className="h-3 w-3 animate-spin rounded-full border border-neutral-300 border-t-red-500" />
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                      >
                        <path d="M2.5 4h11M6 4V2.5a1 1 0 011-1h2a1 1 0 011 1V4m2 0-.6 9.4a1 1 0 01-1 .9H5.6a1 1 0 01-1-.9L4 4" />
                      </svg>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-[#e5e5e5] py-8">
        <div className="mx-auto max-w-7xl px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-300">
            Powered by Sarvam AI
          </p>
        </div>
      </footer>
    </main>
  )
}
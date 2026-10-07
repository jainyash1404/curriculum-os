import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { AnalyticsSummary } from '@/lib/pipeline/runner'
import { getAnalyticsSummaryServerFn } from '@/lib/pipeline/server'

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
})

const LEVEL_COLORS: Record<string, string> = {
  beginner: '#f59e0b',
  intermediate: '#4338ca',
  advanced: '#10b981',
  mixed: '#a855f7',
}

const STATUS_COLORS: Record<string, string> = {
  ready: '#10b981',
  generating: '#4338ca',
  planning: '#a855f7',
  draft: '#a3a3a3',
  failed: '#ef4444',
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max: number
  color: string
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs capitalize text-neutral-500">
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-6 shrink-0 text-right text-xs text-neutral-400">
        {value}
      </span>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
      <p className="font-serif text-3xl font-bold text-[#171717]">{value}</p>
      <p className="oi-mono-label mt-1 text-neutral-400">{label}</p>
    </div>
  )
}

function AnalyticsPage() {
  const getSummary = useServerFn(getAnalyticsSummaryServerFn)
  const [data, setData] = React.useState<AnalyticsSummary | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    getSummary()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setState('ready')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load.')
          setState('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [getSummary])

  return (
    <div className="min-h-screen bg-[#fafaf9] pb-24">
      <header className="border-b border-[#e5e5e5] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link
            to="/"
            className="font-serif text-lg italic text-[#171717]"
          >
            CurriculumOS
          </Link>
          <nav className="flex items-center gap-6 text-xs uppercase tracking-wide text-neutral-500">
            <Link to="/studio" className="hover:text-[#171717]">
              Studio
            </Link>
            <Link to="/courses" className="hover:text-[#171717]">
              Courses
            </Link>
            <span className="text-[#4338ca]">Analytics</span>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pt-10">
        <h1 className="font-serif text-2xl font-bold text-[#171717]">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Aggregated directly from the pipeline's own records — lessons,
          learner profiles, and per-stage generation runs. No separate
          tracking system.
        </p>

        {state === 'loading' && (
          <div className="mt-16 flex justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-[#4338ca]" />
          </div>
        )}

        {state === 'error' && (
          <div className="mt-10 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error}
            {error.toLowerCase().includes('convex') ||
            error.toLowerCase().includes('fetch') ? (
              <p className="mt-1 text-xs text-red-500">
                This usually means Convex isn't configured yet — set
                VITE_CONVEX_URL and run `npx convex dev`.
              </p>
            ) : null}
          </div>
        )}

        {state === 'ready' && data && (
          <div className="mt-8 space-y-8">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Total lessons" value={String(data.totalLessons)} />
              <StatCard
                label="Avg diagnostic accuracy"
                value={
                  data.averageDiagnosticAccuracy !== null
                    ? `${Math.round(data.averageDiagnosticAccuracy * 100)}%`
                    : '—'
                }
              />
              <StatCard
                label="Avg profile confidence"
                value={
                  data.averageProfileConfidence !== null
                    ? `${Math.round(data.averageProfileConfidence * 100)}%`
                    : '—'
                }
              />
              <StatCard
                label="Ready lessons"
                value={String(data.statusCounts.ready ?? 0)}
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
                <p className="oi-mono-label mb-4 text-neutral-500">
                  Lessons by status
                </p>
                <div className="space-y-3">
                  {Object.entries(data.statusCounts).length === 0 && (
                    <p className="text-sm text-neutral-400">
                      No lessons generated yet.
                    </p>
                  )}
                  {Object.entries(data.statusCounts).map(([status, count]) => (
                    <Bar
                      key={status}
                      label={status}
                      value={count ?? 0}
                      max={data.totalLessons || 1}
                      color={STATUS_COLORS[status] ?? '#a3a3a3'}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
                <p className="oi-mono-label mb-4 text-neutral-500">
                  Learner levels (from diagnostics)
                </p>
                <div className="space-y-3">
                  {Object.entries(data.levelCounts).length === 0 && (
                    <p className="text-sm text-neutral-400">
                      No diagnostic profiles yet.
                    </p>
                  )}
                  {Object.entries(data.levelCounts).map(([level, count]) => (
                    <Bar
                      key={level}
                      label={level}
                      value={count ?? 0}
                      max={Object.values(data.levelCounts).reduce(
                        (a: number, b) => Math.max(a, b ?? 0),
                        1,
                      )}
                      color={LEVEL_COLORS[level] ?? '#a3a3a3'}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
              <p className="oi-mono-label mb-4 text-neutral-500">
                Pipeline stage success rate
              </p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-4">
                {Object.entries(data.stageCounts).map(([stage, counts]) => {
                  const succeeded = counts?.succeeded ?? 0
                  const failed = counts?.failed ?? 0
                  const total = succeeded + failed
                  const rate =
                    total > 0 ? Math.round((succeeded / total) * 100) : null
                  return (
                    <div key={stage}>
                      <p className="text-xs capitalize text-neutral-400">
                        {stage}
                      </p>
                      <p className="font-serif text-xl font-bold text-[#171717]">
                        {rate !== null ? `${rate}%` : '—'}
                      </p>
                      <p className="text-[10px] text-neutral-400">
                        {succeeded} ok / {failed} failed
                      </p>
                    </div>
                  )
                })}
                {Object.keys(data.stageCounts).length === 0 && (
                  <p className="text-sm text-neutral-400">
                    No generation runs recorded yet.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5">
              <p className="oi-mono-label mb-4 text-neutral-500">
                Recent lessons
              </p>
              {data.recentLessons.length === 0 ? (
                <p className="text-sm text-neutral-400">
                  Nothing generated yet —{' '}
                  <Link to="/studio" className="text-[#4338ca] underline">
                    start a course
                  </Link>
                  .
                </p>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {data.recentLessons.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between py-2.5 text-sm"
                    >
                      <span className="truncate text-[#171717]">
                        {l.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                        <span className="capitalize">{l.language}</span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] capitalize text-white"
                          style={{
                            backgroundColor:
                              STATUS_COLORS[l.status] ?? '#a3a3a3',
                          }}
                        >
                          {l.status}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

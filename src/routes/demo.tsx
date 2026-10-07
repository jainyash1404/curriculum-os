import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { LessonBundle } from '@/lib/pipeline/types'
import { LessonPlayer } from '@/components/lesson-player'

export const Route = createFileRoute('/demo')({ component: DemoPage })

/**
 * The whole point of this page: it works with ZERO configuration.
 *
 * No API keys, no Convex connection, nothing to sign in to. It fetches a
 * static JSON file (public/demo/lesson.json) generated once via
 * `scripts/bake-demo.ts` from a real, already-verified lesson — so anyone
 * who opens the deployed site sees a real generated lesson play
 * immediately, not a screenshot or a "trust me" claim.
 *
 * If lesson.json doesn't exist yet (bake-demo.ts hasn't been run), this
 * shows instructions instead of a blank/broken page.
 */
function DemoPage() {
  const [bundle, setBundle] = React.useState<LessonBundle | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>(
    'loading',
  )

  React.useEffect(() => {
    let cancelled = false
    fetch('/demo/lesson.json')
      .then((res) => {
        if (!res.ok) throw new Error('not found')
        return res.json() as Promise<LessonBundle>
      })
      .then((data) => {
        if (!cancelled) {
          setBundle(data)
          setState('ready')
        }
      })
      .catch(() => {
        if (!cancelled) setState('missing')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafaf9]">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 border-t-[#4338ca]" />
      </div>
    )
  }

  if (state === 'missing') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fafaf9] px-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#4338ca]">
          Demo not baked yet
        </p>
        <h1 className="max-w-md font-serif text-2xl font-bold text-[#171717]">
          No static demo lesson found.
        </h1>
        <p className="max-w-md text-sm text-neutral-500">
          Generate a course in Studio, then run{' '}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
            bun run scripts/bake-demo.ts --lessonId=&lt;id&gt;
          </code>{' '}
          to populate this page with a real, zero-config demo.
        </p>
        <Link
          to="/studio"
          className="mt-2 rounded-full bg-[#4338ca] px-5 py-2 text-sm text-white transition hover:bg-[#3730a3]"
        >
          Go to Studio
        </Link>
      </div>
    )
  }

  if (!bundle) return null

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a]">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <Link to="/" className="font-serif text-lg italic text-white">
          CurriculumOS
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
          Live demo · no sign-up required
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <LessonPlayer
          bundle={bundle}
          initialTopicIndex={0}
          onBack={() => window.location.assign('/')}
        />
      </div>
    </div>
  )
}
import * as React from 'react'
import { Link } from '@tanstack/react-router'

/**
 * Shared visual shell for /sign-in and /sign-up.
 *
 * Reuses the same brand language as the landing page (dark mesh orbs,
 * Playfair italic display type, JetBrains mono labels, indigo glow) so the
 * first screen a new user sees doesn't feel like a different product from
 * the one they just read about.
 */
export function AuthShell({
  eyebrow,
  title,
  titleEm,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string
  title: string
  titleEm: string
  subtitle: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="oi-hero-section relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      {/* Drifting mesh background, same orbs as the landing hero */}
      <div className="oi-hero-mesh" aria-hidden="true">
        <div className="oi-hero-mesh-orb oi-hero-mesh-orb-a" />
        <div className="oi-hero-mesh-orb oi-hero-mesh-orb-b" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <Link
          to="/"
          className="oi-reveal mb-10 block text-center font-serif text-2xl italic text-white"
        >
          CurriculumOS
        </Link>

        <div
          className="oi-reveal rounded-3xl border border-white/10 bg-white/[0.04] p-9 backdrop-blur-xl"
          style={{
            animationDelay: '120ms',
            boxShadow: '0 30px 80px -20px rgba(67, 56, 202, 0.25)',
          }}
        >
          <p className="oi-mono-label text-indigo-300/70">{eyebrow}</p>
          <h1 className="mt-2 font-serif text-3xl font-bold leading-tight text-white">
            {title} <em className="font-normal italic text-indigo-300">{titleEm}</em>
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">{subtitle}</p>

          <div className="mt-8">{children}</div>
        </div>

        <div className="oi-reveal mt-7 text-center" style={{ animationDelay: '220ms' }}>
          {footer}
        </div>
      </div>
    </div>
  )
}

/** Bottom-border input matching the brand's understated, non-boxy field style. */
export function AuthField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="oi-mono-label text-white/40">{label}</span>
      <input
        {...props}
        className="mt-2 w-full border-b border-white/15 bg-transparent py-2 text-[15px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-indigo-300"
      />
      {hint && <span className="mt-1.5 block text-xs text-white/30">{hint}</span>}
    </label>
  )
}

export function AuthSubmitButton({
  loading,
  loadingLabel,
  children,
}: {
  loading: boolean
  loadingLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="oi-card-hover flex w-full items-center justify-center gap-2 rounded-full bg-white py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-[#171717] transition-all hover:bg-white/90 disabled:opacity-50"
    >
      {loading && (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#171717]/20 border-t-[#171717]" />
      )}
      {loading ? loadingLabel : children}
    </button>
  )
}
import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { signInServerFn } from '@/lib/auth/server'
import { AuthField, AuthShell, AuthSubmitButton } from '@/components/auth-shell'

export const Route = createFileRoute('/sign-in')({ component: SignInPage })

function SignInPage() {
  const signIn = useServerFn(signInServerFn)
  const navigate = useNavigate()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await signIn({ data: { email, password } })
      await navigate({ to: '/courses' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign"
      titleEm="in"
      subtitle="To generate and manage your own courses."
      footer={
        <p className="text-sm text-white/40">
          No account yet?{' '}
          <Link to="/sign-up" className="text-indigo-300 transition-colors hover:text-white">
            Sign up
          </Link>
        </p>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        <AuthField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}

        <AuthSubmitButton loading={loading} loadingLabel="Signing in...">
          Sign in
        </AuthSubmitButton>
      </form>
    </AuthShell>
  )
}
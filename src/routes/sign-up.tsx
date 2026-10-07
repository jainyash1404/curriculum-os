import * as React from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { signUpServerFn } from '@/lib/auth/server'
import { AuthField, AuthShell, AuthSubmitButton } from '@/components/auth-shell'

export const Route = createFileRoute('/sign-up')({ component: SignUpPage })

function SignUpPage() {
  const signUp = useServerFn(signUpServerFn)
  const navigate = useNavigate()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await signUp({ data: { email, password } })
      await navigate({ to: '/studio' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Start free"
      title="Create your"
      titleEm="account"
      subtitle="Generate and keep your own courses — free."
      footer={
        <p className="text-sm text-white/40">
          Already have an account?{' '}
          <Link to="/sign-in" className="text-indigo-300 transition-colors hover:text-white">
            Sign in
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
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}

        <AuthSubmitButton loading={loading} loadingLabel="Creating account...">
          Sign up
        </AuthSubmitButton>
      </form>
    </AuthShell>
  )
}
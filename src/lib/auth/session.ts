import { useSession } from '@tanstack/react-start/server'

/**
 * Uses TanStack Start's built-in session helper rather than hand-rolling
 * cookie signing — it already handles encryption, integrity verification,
 * and secure cookie flags (httpOnly, secure in production) correctly.
 * Reinventing that is exactly the kind of thing that's easy to get subtly
 * wrong (timing attacks, missing flags), so this defers to the framework.
 */
export type AppSessionData = {
  userId: string
}

const SESSION_COOKIE_NAME = 'curriculumos_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

function getSessionPassword(): string {
  const password = process.env.AUTH_SESSION_SECRET
  if (!password || password.length < 32) {
    throw new Error(
      'AUTH_SESSION_SECRET must be set to a random string of at least 32 ' +
        'characters. Generate one with: openssl rand -base64 32 — then add ' +
        'it to .env.local.',
    )
  }
  return password
}

export async function getAppSession() {
  return useSession<AppSessionData>({
    password: getSessionPassword(),
    name: SESSION_COOKIE_NAME,
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}
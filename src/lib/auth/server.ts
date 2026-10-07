import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { hashPassword, verifyPassword } from './password'
import { getAppSession } from './session'
import {
  createConvexClient,
  makeMutationReference,
  makeQueryReference,
} from '@/lib/convex/client'

type UserRecord = {
  _id: string
  email: string
  passwordHash: string
  passwordSalt: string
  createdAt: number
}

type PublicUser = {
  _id: string
  email: string
  createdAt: number
}

async function callMutation<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  const client = createConvexClient()
  return client.mutation(makeMutationReference(name), args) as Promise<TResult>
}

async function callQuery<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  args: TArgs,
): Promise<TResult> {
  const client = createConvexClient()
  return client.query(makeQueryReference(name), args) as Promise<TResult>
}

const credentialsSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

export const signUpServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => credentialsSchema.parse(input))
  .handler(async ({ data }): Promise<{ email: string }> => {
    const { hash, salt } = hashPassword(data.password)
    let userId: string
    try {
      const result = await callMutation<
        { email: string; passwordHash: string; passwordSalt: string },
        { userId: string }
      >('users:createUser', {
        email: data.email,
        passwordHash: hash,
        passwordSalt: salt,
      })
      userId = result.userId
    } catch (err) {
      // Convex mutation errors arrive with extra framework-added text
      // (call stack, request id) prefixed/appended to the actual message —
      // strip down to the message we threw in convex/users.ts so the
      // person sees "An account with this email already exists." instead
      // of a wall of internal error formatting.
      const message = err instanceof Error ? err.message : 'Sign up failed.'
      throw new Error(
        message.includes('already exists')
          ? 'An account with this email already exists.'
          : message,
      )
    }

    const session = await getAppSession()
    await session.update({ userId })
    return { email: data.email.trim().toLowerCase() }
  })

export const signInServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => credentialsSchema.parse(input))
  .handler(async ({ data }): Promise<{ email: string }> => {
    const user = await callQuery<{ email: string }, UserRecord | null>(
      'users:getUserByEmail',
      { email: data.email },
    )
    // Deliberately identical error for "no such user" and "wrong
    // password" — a different message for each would let an attacker
    // enumerate which emails have accounts.
    const invalidMessage = 'Incorrect email or password.'
    if (!user) throw new Error(invalidMessage)

    const valid = verifyPassword(
      data.password,
      user.passwordHash,
      user.passwordSalt,
    )
    if (!valid) throw new Error(invalidMessage)

    const session = await getAppSession()
    await session.update({ userId: user._id })
    return { email: user.email }
  })

export const signOutServerFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await getAppSession()
    await session.clear()
    return { ok: true }
  },
)

export const getCurrentUserServerFn = createServerFn({
  method: 'GET',
}).handler(async (): Promise<PublicUser | null> => {
  const session = await getAppSession()
  const userId = session.data.userId
  if (!userId) return null

  const user = await callQuery<{ userId: string }, PublicUser | null>(
    'users:getUserPublicById',
    { userId },
  )
  if (!user) {
    // Session points at a user that no longer exists (e.g. deleted
    // manually in the Convex dashboard) — clear the stale session instead
    // of leaving the person stuck "logged in" as a ghost account.
    await session.clear()
    return null
  }
  return user
})
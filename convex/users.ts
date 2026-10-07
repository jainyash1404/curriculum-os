import { mutationGeneric, queryGeneric } from 'convex/server'
import { v } from 'convex/values'

/**
 * Password hashing/verification happens in src/lib/auth/password.ts, which
 * runs inside TanStack Start server functions (a real Node.js process) —
 * not here. Convex mutations/queries run in a restricted runtime that
 * isn't guaranteed to have Node's crypto module, so these functions only
 * ever store or read an already-hashed value. Convex never sees a
 * plaintext password.
 */

export const createUser = mutationGeneric({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.trim().toLowerCase()
    // Convex mutations execute as a single atomic transaction, so this
    // check-then-insert is race-safe — two concurrent sign-ups for the
    // same email can't both pass the check and insert a duplicate.
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalizedEmail))
      .unique()
    if (existing) {
      throw new Error('An account with this email already exists.')
    }
    const userId = await ctx.db.insert('users', {
      email: normalizedEmail,
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      createdAt: Date.now(),
    })
    return { userId }
  },
})

export const getUserByEmail = queryGeneric({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.trim().toLowerCase()
    return ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', normalizedEmail))
      .unique()
  },
})

export const getUserPublicById = queryGeneric({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null
    // Deliberately excludes passwordHash/passwordSalt — this is the only
    // read path the client-facing "who's logged in" check goes through.
    return { _id: user._id, email: user.email, createdAt: user.createdAt }
  },
})
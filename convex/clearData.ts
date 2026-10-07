// convex/debug.ts
import { mutation } from './_generated/server'

const TABLES = [
  'lessons',
  'topics',
  'topicScripts',
  'audioAssets',
  'timingTracks',
  'scenePlans',
  'generationRuns',
  'courseProfiles',
] as const

export const clearAll = mutation({
  handler: async (ctx) => {
    for (const table of TABLES) {
      const docs = await ctx.db.query(table as any).collect()
      for (const doc of docs) {
        await ctx.db.delete(doc._id)
      }
    }
  },
})

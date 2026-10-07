import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

function getConvexUrl(): string {
  const url = process.env.VITE_CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error('VITE_CONVEX_URL is required')
  }
  return url
}

export function createConvexClient(): ConvexHttpClient {
  return new ConvexHttpClient(getConvexUrl())
}

export function makeQueryReference(name: string) {
  return makeFunctionReference<'query', Record<string, unknown>, unknown>(name)
}

export function makeMutationReference(name: string) {
  return makeFunctionReference<'mutation', Record<string, unknown>, unknown>(
    name,
  )
}

export function makeActionReference(name: string) {
  return makeFunctionReference<'action', Record<string, unknown>, unknown>(name)
}

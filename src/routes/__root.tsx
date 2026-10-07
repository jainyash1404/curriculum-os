import * as React from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'

/**
 * Route-level fallback. Without this, an unhandled error in any route
 * component (a bad pipeline response, a missing lesson, a rendering bug in
 * a generated scene) renders a blank white page — the worst possible thing
 * to hit mid-demo. This gives the user a way back instead of a dead end.
 */
function RouteErrorFallback({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#fafaf9] px-6 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-red-500">
        Unexpected error
      </p>
      <h1 className="font-serif text-2xl font-bold text-[#171717]">
        That didn&apos;t work.
      </h1>
      <p className="max-w-md text-sm text-neutral-500">{message}</p>
      <button
        type="button"
        onClick={() => window.location.assign('/')}
        className="mt-2 rounded-full bg-[#4338ca] px-5 py-2 text-sm text-white transition hover:bg-[#3730a3]"
      >
        Back to home
      </button>
    </div>
  )
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'CurriculumOS',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous' as const,
      },
    ],
  }),

  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: RouteErrorFallback,
})

function RootComponent() {
  return <Outlet />
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

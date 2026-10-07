import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig(({ mode }) => {
  const isTest = mode === 'test' || process.env.VITEST === 'true'
  const sharedPlugins = [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
  ]

  if (isTest) {
    return {
      plugins: sharedPlugins,
    }
  }

  return {
    plugins: [
      devtools(),
      nitro(),
      ...sharedPlugins,
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})

export default config

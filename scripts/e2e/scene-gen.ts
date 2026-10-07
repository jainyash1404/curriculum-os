import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getTopicModel } from '@/lib/ai/provider'

const sceneSchema = z.object({
  label: z.string().min(2).max(80),
  htmlSpec: z.string().min(200),
})

function parseArg(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`))
  if (inline) {
    return inline.slice(name.length + 3).trim()
  }
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) {
    return process.argv[index + 1]?.trim()
  }
  return undefined
}

async function getPrompt(): Promise<string> {
  const fromArg = parseArg('prompt')
  if (fromArg && fromArg.length > 0) {
    return fromArg
  }

  const rl = createInterface({ input, output })
  const entered = (await rl.question('Scene prompt: ')).trim()
  rl.close()
  if (!entered) {
    throw new Error('Prompt is required.')
  }
  return entered
}

function ensureFullHtmlDocument(html: string): string {
  const trimmed = html.trim()
  if (trimmed.toLowerCase().includes('<html')) {
    return trimmed
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
${trimmed}
</body>
</html>`
}

function copyToClipboard(text: string): void {
  const result = spawnSync('pbcopy', {
    input: text,
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) {
    throw new Error('Failed to copy HTML via pbcopy')
  }
}

async function main() {
  const prompt = await getPrompt()
  const { object } = await generateObject({
    model: getTopicModel(),
    schema: sceneSchema,
    prompt: `You are SceneAgent.
Generate a single, complete, self-contained HTML scene for an educational course player.
The scene must be 16:9, interactive, and animation-rich.
Avoid text-heavy layouts. Use visuals first.
Match site shell styling: predominantly white/cream background (#fcfbf9 or #ffffff), subtle borders, and accent-led motion.
Do not use dark full-page backgrounds.
Avoid generic AI aesthetics: no pulsing blobs/orbs, no breathing glow loops, no random neon gradients.
No external libraries. No network calls. No markdown fences.

Theme ideas:
- kinetic geometry with signal lines
- process-flow playground with toggles/sliders
- abstract data landscape with live state transitions

User prompt:
${prompt}`,
  })
  const label = object.label
  const html = ensureFullHtmlDocument(object.htmlSpec)

  copyToClipboard(html)
  console.log('SCENE_GEN_OK', {
    label,
    copied: true,
    chars: html.length,
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('SCENE_GEN_FAILED', message)
  process.exitCode = 1
})

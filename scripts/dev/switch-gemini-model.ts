import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const MODEL_KEYS = [
  'GEMINI_MODEL',
  'GEMINI_MODEL_PLANNER',
  'GEMINI_MODEL_PROFILER',
  'GEMINI_MODEL_TOPIC',
  'GEMINI_MODEL_QUESTIONNAIRE',
  'GEMINI_MODEL_SCRIPT',
  'GEMINI_MODEL_SCENE',
  'GEMINI_MODEL_TRANSLATOR',
] as const

const PRESETS: Record<string, string> = {
  pro: 'gemini-3-pro-preview',
  flash: 'gemini-3-flash-preview',
}

type CliArgs = {
  model: string
  vercelEnvironment?: 'production' | 'preview' | 'development'
  files: Array<string>
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/dev/switch-gemini-model.ts <pro|flash|model-id> [--vercel production|preview|development] [--files .env.local,.env.production.local]

Examples:
  bun run scripts/dev/switch-gemini-model.ts pro
  bun run scripts/dev/switch-gemini-model.ts flash --vercel production
  bun run scripts/dev/switch-gemini-model.ts gemini-3-pro-preview --vercel production`)
}

function parseArgs(argv: Array<string>): CliArgs {
  const positional: Array<string> = []
  let vercelEnvironment: CliArgs['vercelEnvironment']
  let filesArg: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') {
      printUsage()
      process.exit(0)
    }
    if (token === '--vercel') {
      const value = argv[index + 1]
      if (
        value !== 'production' &&
        value !== 'preview' &&
        value !== 'development'
      ) {
        throw new Error(
          'Invalid --vercel value. Use production, preview, or development.',
        )
      }
      vercelEnvironment = value
      index += 1
      continue
    }
    if (token === '--files') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --files.')
      }
      filesArg = value
      index += 1
      continue
    }
    positional.push(token)
  }

  const requestedModel = positional[0]
  if (!requestedModel) {
    printUsage()
    throw new Error('Model is required.')
  }

  const model = PRESETS[requestedModel] ?? requestedModel
  const files = (filesArg ?? '.env.local,.env.production.local')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  return {
    model,
    vercelEnvironment,
    files,
  }
}

function setEnvKey(content: string, key: string, value: string): string {
  const rows = content.split(/\r?\n/)
  const existingIndex = rows.findIndex((row) => row.startsWith(`${key}=`))
  if (existingIndex >= 0) {
    rows[existingIndex] = `${key}=${value}`
  } else {
    rows.push(`${key}=${value}`)
  }

  return `${rows.join('\n').replace(/\n+$/g, '')}\n`
}

function writeModelToEnvFile(filePath: string, model: string): void {
  const absolutePath = resolve(process.cwd(), filePath)
  const current = existsSync(absolutePath)
    ? readFileSync(absolutePath, 'utf8')
    : ''
  let next = current
  for (const key of MODEL_KEYS) {
    next = setEnvKey(next, key, model)
  }
  writeFileSync(absolutePath, next, 'utf8')
  console.log(`updated ${filePath}`)
}

function syncVercelEnvironment(
  envName: NonNullable<CliArgs['vercelEnvironment']>,
  model: string,
): void {
  for (const key of MODEL_KEYS) {
    spawnSync('vercel', ['env', 'rm', key, envName, '--yes'], {
      stdio: 'ignore',
    })

    const add = spawnSync('vercel', ['env', 'add', key, envName], {
      input: `${model}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (add.status !== 0) {
      const stderrOutput = typeof add.stderr === 'string' ? add.stderr : ''
      const stderr =
        stderrOutput.trim().length > 0 ? stderrOutput.trim() : 'unknown error'
      throw new Error(`Failed to set ${key} on Vercel (${envName}): ${stderr}`)
    }
  }

  console.log(`synced Vercel ${envName} environment`)
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  for (const filePath of args.files) {
    writeModelToEnvFile(filePath, args.model)
  }

  if (args.vercelEnvironment) {
    syncVercelEnvironment(args.vercelEnvironment, args.model)
  }

  console.log(`active Gemini model: ${args.model}`)
}

main()

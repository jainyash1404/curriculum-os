import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

type VercelEnvironment = 'production' | 'preview' | 'development'

type CliOptions = {
  file: string
  environment: VercelEnvironment
  prune: boolean
  dryRun: boolean
  allowEmpty: boolean
}

function parseArgs(argv: Array<string>): CliOptions {
  let file = '.env.production.local'
  let environment: VercelEnvironment = 'production'
  let prune = true
  let dryRun = false
  let allowEmpty = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') {
      printUsage()
      process.exit(0)
    }
    if (token === '--file') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --file')
      }
      file = value
      index += 1
      continue
    }
    if (token === '--environment') {
      const value = argv[index + 1]
      if (
        value !== 'production' &&
        value !== 'preview' &&
        value !== 'development'
      ) {
        throw new Error(
          'Invalid --environment value. Use production, preview, or development.',
        )
      }
      environment = value
      index += 1
      continue
    }
    if (token === '--no-prune') {
      prune = false
      continue
    }
    if (token === '--dry-run') {
      dryRun = true
      continue
    }
    if (token === '--allow-empty') {
      allowEmpty = true
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  return { file, environment, prune, dryRun, allowEmpty }
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/dev/sync-vercel-env.ts [--file .env.production.local] [--environment production] [--no-prune] [--dry-run] [--allow-empty]

Examples:
  bun run scripts/dev/sync-vercel-env.ts --file .env.production.local --environment production
  bun run scripts/dev/sync-vercel-env.ts --file .env.local --environment development --no-prune`)
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1)
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

function stripInlineComment(raw: string): string {
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '#' && index > 0 && /\s/.test(raw[index - 1])) {
      return raw.slice(0, index).trimEnd()
    }
  }
  return raw
}

function parseEnvFile(
  filePath: string,
  allowEmpty: boolean,
): Map<string, string> {
  const absolutePath = resolve(process.cwd(), filePath)
  if (!existsSync(absolutePath)) {
    throw new Error(`Env file not found: ${filePath}`)
  }

  const content = readFileSync(absolutePath, 'utf8')
  const rows = content.split(/\n/)
  const parsed = new Map<string, string>()
  const emptyKeys: Array<string> = []

  for (const rawRow of rows) {
    const row = rawRow.replace(/\r$/, '')
    const trimmedStart = row.trimStart()
    if (!trimmedStart || trimmedStart.startsWith('#')) {
      continue
    }

    const normalized = trimmedStart.startsWith('export ')
      ? trimmedStart.slice(7)
      : trimmedStart
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex < 1) {
      continue
    }

    const key = normalized.slice(0, separatorIndex).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      continue
    }

    const rawValue = normalized.slice(separatorIndex + 1).trim()
    const withoutComment = stripInlineComment(rawValue)
    const value = unquote(withoutComment).replace(/\r/g, '')

    if (!allowEmpty && value.length === 0) {
      emptyKeys.push(key)
    }

    parsed.set(key, value)
  }

  if (emptyKeys.length > 0) {
    throw new Error(
      `Empty values found for keys: ${emptyKeys.join(', ')}. Fill them or pass --allow-empty.`,
    )
  }

  return parsed
}

function runVercelCommand(
  args: Array<string>,
  input?: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('vercel', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function getExistingKeys(environment: VercelEnvironment): Set<string> {
  const result = runVercelCommand(['env', 'list', environment])
  if (result.status !== 0) {
    throw new Error(`Failed to list Vercel env vars: ${result.stderr.trim()}`)
  }

  const keys = new Set<string>()
  for (const row of result.stdout.split('\n')) {
    const match = row.match(/^\s*([A-Z][A-Z0-9_]*)\s+Encrypted\s+/)
    if (match?.[1]) {
      keys.add(match[1])
    }
  }
  return keys
}

function removeKey(key: string, environment: VercelEnvironment): void {
  runVercelCommand(['env', 'remove', key, environment, '--yes'])
}

function addKey(
  key: string,
  value: string,
  environment: VercelEnvironment,
): void {
  const result = runVercelCommand(['env', 'add', key, environment], value)
  if (result.status !== 0) {
    const details =
      result.stderr.trim() || result.stdout.trim() || 'unknown error'
    throw new Error(`Failed to set ${key}: ${details}`)
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const fileValues = parseEnvFile(options.file, options.allowEmpty)
  const existingKeys = getExistingKeys(options.environment)

  const keysToSet = [...fileValues.keys()]
  const keysToRemove = options.prune
    ? [...existingKeys].filter((key) => !fileValues.has(key))
    : []

  console.log(
    `sync plan: set ${keysToSet.length} keys, prune ${keysToRemove.length} keys from ${options.environment}`,
  )

  if (options.dryRun) {
    console.log('dry-run mode enabled, no changes applied')
    return
  }

  for (const key of keysToRemove) {
    removeKey(key, options.environment)
  }

  for (const key of keysToSet) {
    const value = fileValues.get(key) ?? ''
    removeKey(key, options.environment)
    addKey(key, value, options.environment)
  }

  console.log('VERCEL_ENV_SYNC_OK')
}

main()

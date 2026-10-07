/**
 * Bakes an already-generated, already-verified lesson into fully static
 * assets (public/demo/lesson.json + downloaded audio files) so `/demo`
 * can render a real, working lesson with ZERO runtime dependencies —
 * no API keys, no Convex connection, nothing to configure. Anyone who
 * opens the deployed site (a recruiter, an interviewer) sees a real
 * generated lesson play immediately.
 *
 * This does NOT call Gemini or Sarvam itself — it exports a lesson you've
 * already generated through the normal Studio flow (so you know it's
 * good) into a static, shareable form.
 *
 * Usage:
 *   bun run scripts/bake-demo.ts --lessonId=<id from Convex/your Courses list>
 *
 * Requires the same .env.local (Convex URL) as the rest of the app, since
 * it's exporting an existing lesson via the same Convex client the runner
 * uses. It's a one-time build step, not a runtime dependency.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LessonBundle } from '@/lib/pipeline/types'
import { fetchLessonBundle } from '@/lib/pipeline/runner'

function parseArgValue(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

async function downloadAudio(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download audio (${res.status}): ${url}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  await writeFile(destPath, buffer)
}

async function main() {
  const lessonId = parseArgValue('lessonId')
  if (!lessonId) {
    console.error(
      'Usage: bun run scripts/bake-demo.ts --lessonId=<id>\n\n' +
        'Get a lessonId by generating a course in Studio, then checking\n' +
        'the Convex dashboard (lessons table) or your browser URL on the\n' +
        'course page for its _id.',
    )
    process.exit(1)
  }

  console.log(`Fetching lesson bundle for ${lessonId}...`)
  const bundle = await fetchLessonBundle(lessonId)
  if (!bundle) {
    console.error(`No lesson found for id "${lessonId}".`)
    process.exit(1)
  }
  if (bundle.lesson.status !== 'ready') {
    console.warn(
      `Warning: lesson status is "${bundle.lesson.status}", not "ready". ` +
        'The baked demo may have missing audio or scenes.',
    )
  }

  const demoDir = resolve(process.cwd(), 'public', 'demo')
  await mkdir(demoDir, { recursive: true })

  const bakedTopics: LessonBundle['topics'] = []
  for (const [i, topicBundle] of bundle.topics.entries()) {
    const audio = topicBundle.audio
    if (!audio?.playbackUrl) {
      bakedTopics.push(topicBundle)
      continue
    }
    const filename = `audio-${i}.mp3`
    console.log(`Downloading audio for topic ${i + 1}: ${filename}`)
    await downloadAudio(audio.playbackUrl, resolve(demoDir, filename))
    bakedTopics.push({
      ...topicBundle,
      audio: { ...audio, playbackUrl: `/demo/${filename}` },
    })
  }

  const bakedBundle: LessonBundle = { ...bundle, topics: bakedTopics }
  await writeFile(
    resolve(demoDir, 'lesson.json'),
    JSON.stringify(bakedBundle, null, 2),
  )

  console.log(
    `\nBaked. public/demo/lesson.json + ${bakedTopics.filter((t) => t.audio?.playbackUrl?.startsWith('/demo/')).length} audio file(s) written.\n` +
      'Visit /demo (no API keys or Convex needed at runtime) to verify, then deploy.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
import { describe, expect, it } from 'vitest'
import {
  alignAnimationBlocksToScenes,
  estimateCuesFromScript,
  normalizeLanguage,
  parseScriptAnimationBlocks,
  parseSourceTopicJson,
  parseTranscriptCues,
  partitionAnimationBlocks,
} from './source'

describe('source parsing utilities', () => {
  it('parses source json fields safely', () => {
    const parsed = parseSourceTopicJson(
      JSON.stringify({
        title: 'Demo Lesson',
        description: 'A short description',
        topic_uuid: 'topic-123',
        content: {
          script: 'hello world',
          animation_markup: '<script_animation></script_animation>',
          transcript_text: '{"monologues":[]}',
          audio_url: 'https://example.com/audio.mp3',
        },
      }),
    )

    expect(parsed.title).toBe('Demo Lesson')
    expect(parsed.description).toBe('A short description')
    expect(parsed.topicUuid).toBe('topic-123')
    expect(parsed.content.script).toBe('hello world')
    expect(parsed.content.audioUrl).toContain('audio.mp3')
  })

  it('extracts script-animation blocks and aligns scenes by weight', () => {
    const markup = `
<script_animation>
  <script_part>short line</script_part>
  <animation_html_code><div>Scene 1</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>This is a much longer script block for second scene</script_part>
  <animation_html_code><div>Scene 2</div></animation_html_code>
</script_animation>
`

    const blocks = parseScriptAnimationBlocks(markup)
    const scenes = alignAnimationBlocksToScenes(blocks, 9000)

    expect(blocks).toHaveLength(2)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]?.startMs).toBe(0)
    expect(scenes[1]?.endMs).toBe(9000)
    expect(scenes[1]?.endMs).toBeGreaterThan(scenes[0]?.endMs ?? 0)
  })

  it('partitions animation blocks across topics without dropping blocks', () => {
    const markup = `
<script_animation>
  <script_part>alpha one</script_part>
  <animation_html_code><div>A</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>beta two words</script_part>
  <animation_html_code><div>B</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>gamma with more words in this section</script_part>
  <animation_html_code><div>C</div></animation_html_code>
</script_animation>
<script_animation>
  <script_part>delta section detail detail detail</script_part>
  <animation_html_code><div>D</div></animation_html_code>
</script_animation>
`

    const blocks = parseScriptAnimationBlocks(markup)
    const partitions = partitionAnimationBlocks(blocks, 3)

    expect(partitions).toHaveLength(3)
    expect(partitions[0]?.length).toBeGreaterThan(0)
    expect(partitions[1]?.length).toBeGreaterThan(0)
    expect(partitions[2]?.length).toBeGreaterThan(0)

    const flattened = partitions.flat()
    expect(flattened).toHaveLength(blocks.length)
    const flattenedHtml = flattened.map((block) => block.html).join('\n')
    expect(flattenedHtml).toContain('<div>A</div>')
    expect(flattenedHtml).toContain('<div>D</div>')
  })

  it('parses transcript cues and builds fallback cues when missing', () => {
    const cues = parseTranscriptCues(
      JSON.stringify({
        monologues: [
          {
            elements: [
              { type: 'text', value: 'hello', ts: 0, end_ts: 0.2 },
              { type: 'text', value: 'world', ts: 0.25, end_ts: 0.55 },
            ],
          },
        ],
      }),
    )

    expect(cues).toHaveLength(2)
    expect(cues[0]?.token).toBe('hello')
    expect(cues[1]?.startMs).toBe(250)

    const fallback = estimateCuesFromScript('one two three')
    expect(fallback).toHaveLength(3)
    expect(fallback[0]?.startMs).toBe(0)
    expect((fallback[2]?.endMs ?? 0) > (fallback[1]?.endMs ?? 0)).toBe(true)
  })

  it('normalizes supported language aliases', () => {
    expect(normalizeLanguage('EN')).toBe('english')
    expect(normalizeLanguage('hi')).toBe('hindi')
    expect(normalizeLanguage('ta')).toBe('tamil')
    expect(normalizeLanguage('te')).toBe('telugu')
  })
})

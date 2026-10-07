import * as React from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { LessonBundle, TimingCue } from '@/lib/pipeline/types'
import { switchTopicLanguageServerFn } from '@/lib/pipeline/server'

/* ─── Types ─── */

type TranscriptSegment = {
  text: string
  startMs: number
  endMs: number
}

/* ─── Helpers ─── */

function groupBySentence(cues: Array<TimingCue>): Array<TranscriptSegment> {
  if (!cues.length) return []
  const segments: Array<TranscriptSegment> = []
  let tokens: Array<string> = []
  let start = cues[0].startMs
  let end = cues[0].endMs

  for (let i = 0; i < cues.length; i++) {
    tokens.push(cues[i].token)
    end = cues[i].endMs

    const endsLine = /[.!?]['"'")]*$/.test(cues[i].token.trim())
    if (endsLine || i === cues.length - 1) {
      segments.push({ text: tokens.join(' '), startMs: start, endMs: end })
      tokens = []
      if (i + 1 < cues.length) start = cues[i + 1].startMs
    }
  }
  return segments
}

function groupByTime(
  cues: Array<TimingCue>,
  chunkMs = 5000,
): Array<TranscriptSegment> {
  if (!cues.length) return []
  const segments: Array<TranscriptSegment> = []
  let tokens: Array<string> = []
  let start = cues[0].startMs
  let end = cues[0].endMs

  for (const cue of cues) {
    tokens.push(cue.token)
    end = cue.endMs
    if (end - start >= chunkMs) {
      segments.push({ text: tokens.join(' '), startMs: start, endMs: end })
      tokens = []
      start = end
    }
  }
  if (tokens.length) {
    segments.push({ text: tokens.join(' '), startMs: start, endMs: end })
  }
  return segments
}

function buildSegments(cues: Array<TimingCue>): Array<TranscriptSegment> {
  const byLine = groupBySentence(cues)
  if (byLine.length <= 1 && cues.length > 10) return groupByTime(cues)
  return byLine
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* ─── Component ─── */

export function LessonPlayer({
  bundle,
  initialTopicIndex = 0,
  onBack,
}: {
  bundle: LessonBundle
  initialTopicIndex?: number
  onBack: () => void
}) {
  const [topicIdx, setTopicIdx] = React.useState(initialTopicIndex)
  const [timeMs, setTimeMs] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [topicPanel, setTopicPanel] = React.useState(false)
  // Phase 2, item 8: surfaced failure states instead of a silently dead
  // player. Reset per-topic so switching topics clears a stale error.
  const [audioError, setAudioError] = React.useState(false)
  const [sceneError, setSceneError] = React.useState(false)

  /* Phase 3, item 10: mid-playback language switch. Keyed per topic so
   * navigating away and back doesn't lose (or wrongly reuse) a switched
   * track for a different topic. */
  const switchLanguage = useServerFn(switchTopicLanguageServerFn)
  const [langOverride, setLangOverride] = React.useState<
    Map<string, { url: string; language: string }>
  >(new Map())
  const [langState, setLangState] = React.useState<
    'idle' | 'loading' | 'error'
  >('idle')
  const [langError, setLangError] = React.useState('')
  const [langMenuOpen, setLangMenuOpen] = React.useState(false)

  /* Playback speed */
  const [playbackRate, setPlaybackRate] = React.useState(1)
  const [speedMenuOpen, setSpeedMenuOpen] = React.useState(false)
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

  React.useEffect(() => {
    const a = audioRef.current
    if (a) a.playbackRate = playbackRate
  }, [playbackRate])

  /* Phase 3, item 9: export the lesson as a video file.
   *
   * There is no reliable way to draw a sandboxed `srcDoc` iframe onto a
   * <canvas> for frame-by-frame capture (it's treated as an opaque/tainted
   * origin, so canvas readback is blocked). The standards-track way to
   * capture arbitrary on-screen content — including the scene iframe and
   * audio together — is screen/tab capture via getDisplayMedia, which is
   * why this asks the user to pick "this tab" rather than recording
   * silently. Output is WebM (browser-native via MediaRecorder); true MP4
   * muxing would need ffmpeg.wasm, which is a meaningfully heavier
   * dependency left out of this pass.
   */
  const [exportState, setExportState] = React.useState<
    'idle' | 'requesting' | 'recording' | 'error'
  >('idle')
  const [exportError, setExportError] = React.useState('')
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const recordedChunksRef = React.useRef<Array<Blob>>([])

  async function startExport() {
    // TS's DOM lib types mediaDevices/getDisplayMedia as always present,
    // but that's not true in every real browser (older Safari/Firefox
    // versions) — this guard is genuine runtime safety, not dead code.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      setExportState('error')
      setExportError('Screen recording is not supported in this browser.')
      return
    }
    setExportState('requesting')
    setExportError('')
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      })

      // Prefer capturing the actual <audio> element's decoded output so
      // narration is in the recording even if the OS/browser doesn't route
      // tab audio into the display capture's audio track.
      let combinedStream = displayStream
      try {
        const audioEl = audioRef.current
        // Cast window to a shape where both constructors are genuinely
        // optional — the real (un-cast) DOM lib types window.AudioContext
        // as always-present and doesn't know webkitAudioContext at all,
        // which would make the checks below type-check as dead code even
        // though they're real runtime fallbacks for older Safari.
        const win = window as unknown as {
          AudioContext?: typeof AudioContext
          webkitAudioContext?: typeof AudioContext
        }
        const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext
        if (audioEl && AudioContextCtor) {
          const ctx = new AudioContextCtor()
          const source = ctx.createMediaElementSource(audioEl)
          const dest = ctx.createMediaStreamDestination()
          source.connect(dest)
          source.connect(ctx.destination)
          combinedStream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ])
        }
      } catch {
        // If element capture isn't available for any reason, fall back to
        // whatever audio getDisplayMedia itself captured.
      }

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
      })
      recordedChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: 'video/webm',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${topic.topic.title.replace(/\s+/g, '-').toLowerCase()}.webm`
        a.click()
        URL.revokeObjectURL(url)
        setExportState('idle')
        displayStream.getTracks().forEach((t) => t.stop())
      }
      // If the user stops sharing from the browser's own UI, end recording.
      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        }
      })

      recorderRef.current = recorder
      recorder.start()
      setExportState('recording')

      setTimeMs(0)
      const a = audioRef.current
      if (a) {
        a.currentTime = 0
        void a.play()
      }
      setPlaying(true)
    } catch (err) {
      setExportState('error')
      setExportError(
        err instanceof Error ? err.message : 'Could not start recording.',
      )
    }
  }

  function stopExport() {
    recorderRef.current?.stop()
  }

  const audioRef = React.useRef<HTMLAudioElement>(null)
  const transcriptRef = React.useRef<HTMLDivElement>(null)
  const visRef = React.useRef<HTMLDivElement>(null)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const playerContainerRef = React.useRef<HTMLDivElement>(null)
  const [frameSize, setFrameSize] = React.useState({ w: 0, h: 0 })

  /* Fullscreen (maximize/minimize) */
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  React.useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await playerContainerRef.current?.requestFullscreen()
      }
    } catch {
      // Fullscreen can be blocked by the browser (e.g. no user-gesture
      // context, or a platform that doesn't support the API at all, like
      // some mobile browsers) — fail silently rather than showing an
      // error for what's a nice-to-have, not a core feature.
    }
  }

  /* Double-click/double-tap left half = -10s, right half = +10s (a
   * YouTube/Netflix-style seek gesture). Shows a brief +10/-10 flash so
   * the seek is visible even though there's no persistent skip button
   * under the cursor. */
  const [seekFlash, setSeekFlash] = React.useState<
    { dir: 'back' | 'forward'; key: number } | null
  >(null)

  function handleVisualizationDoubleClick(
    e: React.MouseEvent<HTMLDivElement>,
  ) {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const isRightHalf = clickX > rect.width / 2
    skip(isRightHalf ? 10000 : -10000)
    setSeekFlash({ dir: isRightHalf ? 'forward' : 'back', key: Date.now() })
  }

  React.useEffect(() => {
    if (!seekFlash) return
    const timer = setTimeout(() => setSeekFlash(null), 500)
    return () => clearTimeout(timer)
  }, [seekFlash])
  const topic = bundle.topics[topicIdx]
  const dur = topic.audio?.durationMs ?? 0
  const pct = dur > 0 ? (timeMs / dur) * 100 : 0

  const activeLangOverride = langOverride.get(topic.topic._id)
  const effectiveAudioSrc = activeLangOverride?.url ?? topic.audio?.playbackUrl

  // Swapping the <audio> element's src (new topic, or a re-synthesized
  // language track) is a fresh media load, which every browser resets
  // playbackRate to 1 for — without this, a chosen speed would silently
  // drop back to 1x the moment you change topic or language.
  React.useEffect(() => {
    const a = audioRef.current
    if (a) a.playbackRate = playbackRate
  }, [effectiveAudioSrc])

  async function handleLanguageSwitch(targetLanguage: string) {
    setLangMenuOpen(false)
    if (!topic.script?.transcript) {
      setLangState('error')
      setLangError('No script text available for this topic.')
      return
    }
    setLangState('loading')
    setLangError('')
    try {
      const result = await switchLanguage({
        data: {
          script: topic.script.transcript,
          targetLanguage,
        },
      })
      const src = result.audio.base64Audio
        ? `data:${result.audio.mimeType};base64,${result.audio.base64Audio}`
        : result.audio.externalAudioUrl
      if (!src) throw new Error('No audio returned for that language.')
      setLangOverride((prev) => {
        const next = new Map(prev)
        next.set(topic.topic._id, { url: src, language: targetLanguage })
        return next
      })
      setAudioError(false)
      setTimeMs(0)
      const a = audioRef.current
      if (a) {
        a.currentTime = 0
        a.pause()
      }
      setPlaying(false)
      setLangState('idle')
    } catch (err) {
      setLangState('error')
      setLangError(err instanceof Error ? err.message : 'Switch failed.')
    }
  }

  /* transcript segments */
  const segments = React.useMemo(
    () => buildSegments(topic.timing?.cues ?? []),
    [topic],
  )

  /* active segment index */
  const activeSeg = React.useMemo(
    () => segments.findIndex((s) => timeMs >= s.startMs && timeMs < s.endMs),
    [segments, timeMs],
  )

  /* active scene */
  const activeScene = React.useMemo(() => {
    return (
      topic.scenes.find((s) => timeMs >= s.startMs && timeMs < s.endMs) ??
      topic.scenes[0]
    )
  }, [topic, timeMs])

  /* fit 16:9 in vis container */
  React.useEffect(() => {
    const el = visRef.current
    if (!el) return
    const pad = 32
    const ro = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width - pad
      const ch = entry.contentRect.height - pad
      if (cw <= 0 || ch <= 0) return
      const ratio = 16 / 9
      let w: number
      let h: number
      if (cw / ch > ratio) {
        h = ch
        w = h * ratio
      } else {
        w = cw
        h = w / ratio
      }
      setFrameSize({ w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* reset on topic change */
  React.useEffect(() => {
    setTimeMs(0)
    setPlaying(false)
    setAudioError(false)
    setSceneError(false)
    const a = audioRef.current
    if (a) {
      a.currentTime = 0
      a.pause()
    }
  }, [topicIdx])

  /* auto-scroll transcript */
  React.useEffect(() => {
    if (activeSeg < 0 || !transcriptRef.current) return
    const el = transcriptRef.current.children[activeSeg] as
      | HTMLElement
      | undefined
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeSeg])

  /* send phase signal to scene iframe */
  const sendPhase = React.useCallback((phase: 'narrate' | 'interact') => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'scene-phase', phase }, '*')
    }
  }, [])

  /* notify scene when playback state changes */
  React.useEffect(() => {
    sendPhase(playing ? 'narrate' : 'interact')
  }, [playing, sendPhase])

  /* controls */
  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) a.pause()
    else void a.play()
  }

  const skip = (ms: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(
      0,
      Math.min(a.duration || 0, a.currentTime + ms / 1000),
    )
  }

  const seekMs = (ms: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, ms / 1000)
  }

  const goTo = (i: number) => {
    setTopicIdx(i)
    setTopicPanel(false)
  }

  return (
    <div
      ref={playerContainerRef}
      className="flex h-screen flex-col overflow-hidden"
      style={{ backgroundColor: '#fcfbf9' }}
    >
      {/* hidden audio element */}
      {effectiveAudioSrc && (
        <audio
          ref={audioRef}
          src={effectiveAudioSrc}
          onTimeUpdate={(e) =>
            setTimeMs(Math.round(e.currentTarget.currentTime * 1000))
          }
          onEnded={() => {
            setPlaying(false)
            if (recorderRef.current?.state === 'recording') {
              recorderRef.current.stop()
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setAudioError(true)
            setPlaying(false)
          }}
        />
      )}

      {/* ── top bar ── */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#e5e5e5] px-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-neutral-500 transition-colors hover:text-[#171717]"
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 16 16"
          >
            <path d="M10 12L6 8l4-4" />
          </svg>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Back
          </span>
        </button>

        <div className="h-4 w-px bg-[#e5e5e5]" />

        <p className="min-w-0 flex-1 truncate font-serif text-sm text-[#171717]">
          {topic.topic.title}
        </p>

        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400">
          {topicIdx + 1} / {bundle.topics.length}
        </span>

        {/* playback speed */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setSpeedMenuOpen((v) => !v)
              setLangMenuOpen(false)
            }}
            aria-label="Playback speed"
            aria-expanded={speedMenuOpen}
            className="flex items-center gap-1 rounded-md border border-[#e5e5e5] px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-neutral-500 transition-colors hover:bg-neutral-100"
          >
            {playbackRate}x
          </button>
          {speedMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-20 rounded-lg border border-[#e5e5e5] bg-white py-1 shadow-lg">
              {SPEED_OPTIONS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    setPlaybackRate(rate)
                    setSpeedMenuOpen(false)
                  }}
                  className={`block w-full px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-neutral-50 ${
                    rate === playbackRate
                      ? 'font-semibold text-[#4338ca]'
                      : 'text-neutral-600'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* language switch (Phase 3, item 10) */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setLangMenuOpen((v) => !v)
              setSpeedMenuOpen(false)
            }}
            disabled={langState === 'loading'}
            aria-label="Switch narration language"
            aria-expanded={langMenuOpen}
            className="flex items-center gap-1 rounded-md border border-[#e5e5e5] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-50"
          >
            {langState === 'loading' ? (
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-300 border-t-neutral-600" />
            ) : (
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6.5" />
                <path d="M1.5 8h13M8 1.5c1.8 1.8 2.8 4.2 2.8 6.5S9.8 12.7 8 14.5C6.2 12.7 5.2 10.3 5.2 8S6.2 3.3 8 1.5z" />
              </svg>
            )}
            {activeLangOverride?.language ?? bundle.lesson.language}
          </button>
          {langMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-[#e5e5e5] bg-white py-1 shadow-lg">
              {['English', 'Hindi', 'Tamil', 'Telugu'].map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => void handleLanguageSwitch(lang)}
                  className="block w-full px-3 py-1.5 text-left text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setTopicPanel((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#e5e5e5] text-neutral-500 transition-colors hover:bg-neutral-100"
          title="Topics"
          aria-label="Show topic list"
          aria-expanded={topicPanel}
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 14 14"
          >
            <path d="M2 3.5h10M2 7h10M2 10.5h10" />
          </svg>
        </button>

        {/* export as video (Phase 3, item 9) */}
        {exportState === 'recording' ? (
          <button
            type="button"
            onClick={stopExport}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-red-600"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
            Stop &amp; save
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startExport()}
            disabled={exportState === 'requesting'}
            aria-label="Export this lesson as a video"
            title="Export as video (screen recording)"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#e5e5e5] text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-50"
          >
            {exportState === 'requesting' ? (
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-neutral-300 border-t-neutral-600" />
            ) : (
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" />
                <path d="M10.5 6.5l3.3-2v7l-3.3-2" />
              </svg>
            )}
          </button>
        )}

        {/* maximize / minimize (fullscreen) */}
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label={isFullscreen ? 'Minimize' : 'Maximize'}
          title={isFullscreen ? 'Minimize' : 'Maximize'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#e5e5e5] text-neutral-500 transition-colors hover:bg-neutral-100"
        >
          {isFullscreen ? (
            <svg
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M6.5 2v3a1.5 1.5 0 0 1-1.5 1.5H2M9.5 2v3A1.5 1.5 0 0 0 11 6.5h3M6.5 14v-3A1.5 1.5 0 0 0 5 9.5H2M9.5 14v-3A1.5 1.5 0 0 1 11 9.5h3" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M2 5.5V2h3.5M14 5.5V2h-3.5M2 10.5V14h3.5M14 10.5V14h-3.5" />
            </svg>
          )}
        </button>
      </header>

      {/* ── main content ── */}
      {exportState === 'error' && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"
        >
          <span>Export failed: {exportError}</span>
          <button
            type="button"
            onClick={() => setExportState('idle')}
            className="underline underline-offset-2 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}
      {langState === 'error' && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"
        >
          <span>Language switch failed: {langError}</span>
          <button
            type="button"
            onClick={() => setLangState('idle')}
            className="underline underline-offset-2 hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}
      {activeLangOverride && langState === 'idle' && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-1.5 text-xs text-indigo-700">
          Playing a re-synthesized {activeLangOverride.language} track —
          scene timing is approximate in this language.
        </div>
      )}
      {audioError && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700"
        >
          <span>
            Narration audio failed to load for this topic — the transcript
            and visuals below still work.
          </span>
          <button
            type="button"
            onClick={() => setAudioError(false)}
            className="underline underline-offset-2 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {/* left: visualization 80% */}
        <div
          ref={visRef}
          onDoubleClick={handleVisualizationDoubleClick}
          className="relative flex w-[80%] items-center justify-center bg-[#171717]"
        >
          {/* Double-click seek flash (YouTube/Netflix-style) */}
          {seekFlash && (
            <div
              key={seekFlash.key}
              className={`oi-seek-flash pointer-events-none absolute top-0 flex h-full w-1/2 items-center justify-center ${
                seekFlash.dir === 'forward' ? 'right-0' : 'left-0'
              }`}
            >
              <div className="flex flex-col items-center gap-1 rounded-full bg-black/50 px-6 py-4 text-white">
                <svg
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  style={{
                    transform:
                      seekFlash.dir === 'back' ? 'scaleX(-1)' : undefined,
                  }}
                >
                  <path d="M23 4v6h-6" />
                  <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
                </svg>
                <span className="text-xs font-medium">
                  {seekFlash.dir === 'forward' ? '+10s' : '-10s'}
                </span>
              </div>
            </div>
          )}

          {topic.scenes.length > 0 &&
          frameSize.w > 0 &&
          activeScene.htmlSpec &&
          !sceneError ? (
            <div
              className="overflow-hidden rounded-lg shadow-2xl"
              style={{ width: frameSize.w, height: frameSize.h }}
            >
              <iframe
                ref={iframeRef}
                key={`${topic.topic._id}-${activeScene.sceneId}`}
                title={`scene-${activeScene.sceneId}`}
                className="h-full w-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin"
                srcDoc={activeScene.htmlSpec}
                onLoad={() => sendPhase(playing ? 'narrate' : 'interact')}
                onError={() => setSceneError(true)}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-8 text-center">
              <svg
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                viewBox="0 0 24 24"
                className="text-white/20"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <path d="M3 15l4-4a2 2 0 012.8 0L14 15M14 13l1.6-1.6a2 2 0 012.8 0L21 14" />
              </svg>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30">
                {sceneError
                  ? 'This scene failed to render'
                  : 'No visualization available'}
              </p>
              {sceneError && (
                <button
                  type="button"
                  onClick={() => setSceneError(false)}
                  className="mt-1 rounded-full border border-white/20 px-4 py-1 text-[10px] uppercase tracking-wider text-white/60 transition hover:border-white/40 hover:text-white"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* right: transcript 20% */}
        <div className="flex w-[20%] flex-col border-l border-[#e5e5e5]">
          <div className="shrink-0 border-b border-[#e5e5e5] px-4 py-3">
            <h3 className="font-serif text-sm font-bold leading-tight text-[#171717]">
              {topic.topic.title}
            </h3>
          </div>

          <div
            ref={transcriptRef}
            className="flex-1 space-y-1 overflow-y-auto px-3 py-3"
          >
            {segments.length > 0 ? (
              segments.map((seg, i) => (
                <button
                  type="button"
                  key={`seg-${seg.startMs}-${i}`}
                  onClick={() => seekMs(seg.startMs)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-relaxed transition-colors ${
                    i === activeSeg
                      ? 'bg-indigo-50 font-medium text-[#171717]'
                      : 'text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  {seg.text}
                </button>
              ))
            ) : topic.script?.transcript ? (
              topic.script.transcript
                .split(/(?<=[.!?])\s+/)
                .filter(Boolean)
                .map((s, i) => (
                  <p
                    key={`line-${i}`}
                    className="px-3 py-2 text-[13px] leading-relaxed text-neutral-500"
                  >
                    {s}
                  </p>
                ))
            ) : (
              <p className="px-3 py-2 text-[13px] text-neutral-400">
                No transcript available.
              </p>
            )}
          </div>
        </div>

        {/* topic list overlay (slides from right) */}
        <div
          className={`absolute right-0 top-0 z-10 flex h-full w-[260px] flex-col border-l border-[#e5e5e5] bg-[#fcfbf9] shadow-xl transition-transform duration-300 ${
            topicPanel ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{ transitionTimingFunction: 'var(--ease-premium)' }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#4338ca]">
              Topics
            </span>
            <button
              type="button"
              onClick={() => setTopicPanel(false)}
              className="text-neutral-400 hover:text-[#171717]"
              aria-label="Close topic list"
            >
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                viewBox="0 0 14 14"
              >
                <path d="M10.5 3.5l-7 7M3.5 3.5l7 7" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {bundle.topics.map((t, i) => (
              <button
                type="button"
                key={t.topic._id}
                onClick={() => goTo(i)}
                className={`w-full border-b border-[#e5e5e5] px-4 py-3 text-left transition-colors ${
                  i === topicIdx ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                }`}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <p className="mt-1 text-[13px] font-medium text-[#171717]">
                  {t.topic.title}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── bottom controls ── */}
      <div className="shrink-0 border-t border-[#e5e5e5] bg-white px-6 pb-4 pt-3">
        {/* progress bar */}
        <div className="flex items-center gap-3">
          <span className="w-10 font-mono text-[10px] tabular-nums text-neutral-500">
            {fmtTime(timeMs)}
          </span>

          <div
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={dur}
            aria-valuenow={timeMs}
            aria-label={`Seek, ${fmtTime(timeMs)} of ${fmtTime(dur)}`}
            className="group relative h-1 flex-1 cursor-pointer rounded-full bg-neutral-200"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const frac = Math.max(
                0,
                Math.min(1, (e.clientX - r.left) / r.width),
              )
              seekMs(frac * dur)
            }}
          >
            <div
              className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[#4338ca]"
              style={{ width: `${pct}%` }}
            />
            <div
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#4338ca] opacity-0 shadow transition-opacity group-hover:opacity-100"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>

          <span className="w-10 text-right font-mono text-[10px] tabular-nums text-neutral-500">
            {fmtTime(dur)}
          </span>
        </div>

        {/* control buttons */}
        <div className="mt-2.5 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => topicIdx > 0 && goTo(topicIdx - 1)}
            disabled={topicIdx === 0}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400 transition-colors hover:text-[#171717] disabled:opacity-30"
          >
            Prev
          </button>

          {/* rewind 10s */}
          <button
            type="button"
            onClick={() => skip(-10000)}
            aria-label="Rewind 10 seconds"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100"
          >
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>

          {/* play / pause */}
          <button
            type="button"
            onClick={toggle}
            disabled={!topic.audio?.playbackUrl || audioError}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#171717] text-white transition-colors hover:bg-[#2a2a2a] disabled:opacity-40"
          >
            {playing ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="currentColor"
              >
                <rect x="4" y="3" width="3.5" height="12" rx="1" />
                <rect x="10.5" y="3" width="3.5" height="12" rx="1" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="currentColor"
              >
                <path d="M5 3.5l10 5.5-10 5.5V3.5z" />
              </svg>
            )}
          </button>

          {/* forward 10s */}
          <button
            type="button"
            onClick={() => skip(10000)}
            aria-label="Forward 10 seconds"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100"
          >
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() =>
              topicIdx < bundle.topics.length - 1 && goTo(topicIdx + 1)
            }
            disabled={topicIdx >= bundle.topics.length - 1}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400 transition-colors hover:text-[#171717] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
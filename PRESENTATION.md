# Presenting CurriculumOS

A script for a 3-5 minute walkthrough, mapped to what's actually implemented
(not aspirational). Use this as talking points, not a script to read verbatim.

## 1. The problem (15s)

"Two problems compound for a lot of Indian learners: AI course tools are
almost entirely English-only, and even the ones that aren't stop at
translated text — the personalization underneath still assumes an
English-first learner. Someone who thinks better in Hindi or Tamil gets a
worse product either way."

## 2. The idea (15s)

"CurriculumOS runs a short adaptive diagnostic first, builds a learner
profile from the answers, and generates a lesson natively narrated in one
of 11 Indian languages via Sarvam AI — not machine-translated captions
bolted onto an English course. The personalization and the language are
both first-class, not one bolted onto the other."

## 3. Live demo (90-120s) — the core of the pitch

Walk through the actual flow, narrating what's happening at each step:

1. **Topic + objective** → "I type a topic and what I want to be able to do
   after the lesson."
2. **Diagnostic quiz** → "The `QuestionnaireAgent` generates questions
   calibrated to this specific topic — not a generic quiz bank."
3. **Profile build** → "The `ProfilerAgent` scores my answers for confidence
   and accuracy, and classifies my level."
4. **Generation** → "Now six agents run in sequence: planning, scripting,
   translation, voice synthesis, timing, and scene generation." (point at
   the stage-progress indicator while it runs)
5. **Playback** → "The result: narrated audio, synced to an interactive
   scene the model generated for this specific topic — not a stock
   template." Scrub the timeline to show scene switching.

## 4. Architecture (30-45s) — for technical audiences

"It's a 7-stage pipeline, each stage's state persisted in Convex, so a
lesson's progress is inspectable mid-run, not just pass/fail at the end.
The player syncs audio position to the AI-generated HTML scene via
`postMessage`, keyed off word-level timing cues from the TTS output."

Point to `README.md`'s pipeline diagram if you have the repo open.

## 5. What's real vs. what's next — say this out loud, don't dodge it

Being upfront here builds more credibility than pretending it's finished.

**Actually built:**
- Full 7-stage pipeline with retry/backoff, tested with mocked AI calls
- Real-time-feeling stage progress in the generation UI
- Rate limiting on the AI-calling endpoints
- Accessible player controls (keyboard seek, labeled transport buttons)
- Graceful error fallback instead of a blank crash screen

**Honest gaps (say these before someone asks):**
- No authentication layer yet — single-tenant today
- No production load testing
- [Update this once you deploy] — live URL / hasn't been deployed with a
  public API key yet

## 6. Close (10s)

"The interesting engineering problem here wasn't calling an LLM — it was
keeping seven async stages, a database, and a synced media player all
honest with each other. That's what I'd want to talk through in more
detail."

---

## Anticipated questions — have an answer ready

- **"What does it cost per lesson?"** → Estimate from your own test runs
  (Gemini + Sarvam token/character cost) once you've run it live. Don't
  guess a number in the room — measure it first.
- **"How does this scale to 10,000 users?"** → Rate limiting exists but is
  per-process/in-memory today (see comment in `src/lib/pipeline/server.ts`)
  — say plainly it'd move to a shared store (Redis/Upstash) before real
  traffic, and that Convex handles the DB scaling question already.
- **"Is content reviewed before it reaches a learner?"** → Point to the QA
  stage in the pipeline — describe what it currently checks, and where
  you'd add human-in-the-loop review if this went further.
- **"Why not just use an existing platform?"** → Say the two things
  directly: (1) native-language narration in 11 Indian languages — not
  translated captions over English content, which is what most
  "multilingual" ed-tech actually ships, and (2) the diagnostic-driven
  personalization plus synced interactive scenes, not just text or video.

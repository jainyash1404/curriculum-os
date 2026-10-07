# 🎓 CurriculumOS

**Technical courses that teach in *your* language, not just translate into it.**
Give it a topic, take a short diagnostic, and get a fully narrated, interactive
lesson in Hindi, Tamil, Telugu, or 8 other Indian languages — personalized to
what you already know, not a generic script.

> 🧠 Diagnostic-driven personalization · 🗣️ 11-language native narration (Sarvam AI) · 🤖 Multi-agent AI pipeline
> ⚡ Built with TanStack Start, Convex, Google Gemini, Sarvam AI TTS

![demo](./docs/demo.gif)
<!-- drop your 20-30s screen recording here: topic -> diagnostic -> lesson
     playing -> language switch to Hindi/Tamil -->

---

## ✨ Why this exists

Most AI course generators are English-only, and the ones that aren't usually
stop at translated subtitles — the narration, pacing, and personalization stay
built for an English-first learner. **CurriculumOS flips that assumption**:
the learner's native language *is* the lesson, not an afterthought.

Two things make it different from "just prompt an LLM for a course":

- 🧪 **It diagnoses before it teaches.** A short adaptive quiz builds a
  learner profile first — so a beginner and an advanced learner asking about
  the *same topic*, in the *same language*, get genuinely different lessons.
- 🔄 **Language is a runtime feature, not a one-time export.** Switch
  narration language **mid-playback** — the system re-synthesizes audio for
  that topic live, through the same pipeline that generated the course.

## 🏗️ Architecture
topic + objective
│
▼
QuestionnaireAgent → adaptive diagnostic quiz
│
▼
ProfilerAgent → learner profile (level, gaps, strengths)
│
▼
Planner / Topic → course structure, per-topic briefs
│
▼
Script writer → narration script per topic
│
▼
Sarvam TTS → synthesized voice (11 languages)
│
▼
Timing agent → word/scene-level timing cues
│
▼
SceneAgent → interactive HTML scene per topic
│
▼
QA stage → validates the bundle before it's marked ready
│
▼
LessonPlayer → plays audio + swaps scenes via postMessage,
keyed off timing cues

Every stage writes its status to Convex live — so a lesson's progress is
**always inspectable mid-run**, not a black box you only see the end result of.

## 🛠️ Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **TanStack Start** | File-based routing + server functions in one framework |
| Backend / DB | **Convex** | Real-time reactive queries — pipeline progress updates live, no polling |
| LLM | **Google Gemini** (per-agent model overrides) | Structured output via `zod` schemas, not regex-parsed text |
| TTS | **Sarvam AI** (`bulbul:v3`) | Native support for 11 Indian languages, not translated-English TTS |
| Auth | Node `scrypt` + signed session cookie | No external auth provider needed |

## ✅ Status

**Fully tested live, end to end** — course generation (Gemini), audio
synthesis (Sarvam TTS), sign-up/sign-in, and **mid-playback language
switching across English, Hindi, and Tamil**, all personally verified
working as of <DATE YOU TESTED THIS>. See [`ITERATION.md`](./ITERATION.md)
for build history, and the demo video above for proof.

## 🚀 Getting started

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier available |
| `SARVAM_API_KEY` | [sarvam.ai](https://sarvam.ai) — sign up for API access |
| `VITE_CONVEX_URL` / `CONVEX_DEPLOYMENT` | auto-filled by `npx convex dev` below |
| `AUTH_SESSION_SECRET` | generate with `openssl rand -base64 32` |

```bash
npx convex dev    # first run opens a browser login and provisions a project
npm run dev       # in a second terminal
```

Open `http://localhost:3000` 🎉

To exercise the pipeline without spending API quota:

```bash
npm run e2e:pipeline        # --mode=sim (default), no external calls
npm run e2e:pipeline:live   # --mode=live, uses real Gemini/Sarvam calls
```

## 🎬 Zero-config demo

Anyone who opens the deployed site — a recruiter, an interviewer, anyone
without API keys — can see a **real generated lesson** at `/demo` with
nothing to configure. Not a mock — a real lesson, generated once and
exported to static files.

```bash
bun run scripts/bake-demo.ts --lessonId=<id>
```

## 🔒 Security notes

- `.env` / `.env.local` are gitignored and must **never** be committed —
  rotate `GOOGLE_GENERATIVE_AI_API_KEY`, `SARVAM_API_KEY`, and
  `AUTH_SESSION_SECRET` immediately if they ever are.
- Sessions are signed with `AUTH_SESSION_SECRET` — treat it like a password.

## 📜 Commands

```bash
npm run dev            # local dev server
npm run convex:dev     # Convex dev deployment (run alongside dev)
npm run build           # production build
npm run test            # unit tests
npm run lint            # eslint
```

## 🎛️ Model overrides via `.env`

- Global fallback: `GEMINI_MODEL`
- Planner: `GEMINI_MODEL_PLANNER`
- Profiler: `GEMINI_MODEL_PROFILER`
- Questionnaire: `GEMINI_MODEL_QUESTIONNAIRE`
- Topic defaults: `GEMINI_MODEL_TOPIC`
- Script writer: `GEMINI_MODEL_SCRIPT`
- Scene generator: `GEMINI_MODEL_SCENE`
- Translator: `GEMINI_MODEL_TRANSLATOR`

Resolution order: specific override → broader fallback → default.

## ☁️ Production deploy (Vercel + Convex)

```bash
bunx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'bun run build'
```

Required production env vars: `CONVEX_DEPLOY_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `SARVAM_API_KEY`, `VITE_CONVEX_URL`.
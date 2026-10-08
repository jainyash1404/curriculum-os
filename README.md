<div align="center">

# 🎓 CurriculumOS

### AI-Powered Personalized Learning Platform

**Learn in your language. At your level. At your pace.**

<br>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TanStack Start](https://img.shields.io/badge/TanStack_Start-FF4154?style=for-the-badge)
![Convex](https://img.shields.io/badge/Convex-EE342F?style=for-the-badge)
![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Sarvam AI](https://img.shields.io/badge/Sarvam_AI-FF6B35?style=for-the-badge)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

<br>

[![Live Website](https://img.shields.io/badge/🌐_Live_Website-Visit-black?style=for-the-badge)](https://curriculum-os-rho.vercel.app/)
[![GitHub](https://img.shields.io/badge/💻_GitHub-Repository-181717?style=for-the-badge&logo=github)](https://github.com/jainyash1404/curriculum-os)

</div>

---

## 🎓 About CurriculumOS

**CurriculumOS** is an AI-powered personalized learning platform that creates technical courses based on the learner's **knowledge level, strengths, gaps, and preferred language**.

Instead of simply translating courses, CurriculumOS generates lessons specifically for the learner.

> 🧠 Diagnostic-driven personalization
> 🗣️ 11 Indian languages
> 🤖 Multi-agent AI pipeline
> ⚡ Real-time course generation
> 🎧 AI-powered native narration

---

## ✨ Why CurriculumOS?

Traditional AI course generators:

```text
Topic → Generic Course → Learner
```

CurriculumOS works differently:

```text
Topic
  ↓
Diagnostic Assessment
  ↓
Learner Profile
  ↓
Personalized Curriculum
  ↓
AI Lesson + Native Narration
  ↓
Interactive Learning
```

Two learners studying the same topic can therefore receive completely different lessons.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    A[🎯 Topic] --> B[🧪 Questionnaire Agent]
    B --> C[👤 Profiler Agent]
    C --> D[🧠 Planner Agent]
    D --> E[📚 Topic Generator]
    E --> F[✍️ Script Writer]
    F --> G[🗣️ Sarvam AI TTS]
    G --> H[⏱️ Timing Agent]
    E --> I[🎨 Scene Agent]
    H --> J[🔍 QA]
    I --> J
    J --> K[🎓 Lesson Player]

    B -.-> L[(⚡ Convex)]
    C -.-> L
    D -.-> L
    E -.-> L
    F -.-> L
    G -.-> L
    H -.-> L
    I -.-> L
    J -.-> L
```

---

## 🚀 Features

- 🎯 Diagnostic-Based Personalization
- 🤖 Multi-Agent AI Course Generation
- 🗣️ 11 Indian Language Support
- 🔊 Sarvam AI Native TTS
- 🌍 Mid-Playback Language Switching
- 🎨 Interactive HTML Learning Scenes
- ⏱️ Audio & Scene Synchronization
- ⚡ Real-Time Convex Pipeline
- 🔐 Secure Authentication
- 📊 Personalized Learner Profiles

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TanStack Start, TypeScript |
| Styling | Tailwind CSS |
| AI | Google Gemini |
| TTS | Sarvam AI `bulbul:v3` |
| Backend / DB | Convex |
| Validation | Zod |
| Auth | Node scrypt + Signed Sessions |
| Deployment | Vercel + Convex |

---

## 🌍 Language Support

CurriculumOS supports **11 languages**, including:

Hindi · Bengali · Gujarati · Kannada · Malayalam · Marathi · Odia · Punjabi · Tamil · Telugu · English

---

## ⚡ Getting Started

```bash
git clone https://github.com/jainyash1404/curriculum-os.git
cd curriculum-os
npm install
```

Create `.env.local`:

```env
GOOGLE_GENERATIVE_AI_API_KEY=your_key
SARVAM_API_KEY=your_key
AUTH_SESSION_SECRET=your_secret
VITE_CONVEX_URL=your_convex_url
CONVEX_DEPLOYMENT=your_deployment
```

Run the project:

```bash
npx convex dev
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## 🔐 Security

- Secure password hashing with scrypt
- Signed session cookies
- Server-side validation
- Environment-based secrets
- API keys excluded from source control

---

## 🗺️ Roadmap

- [x] AI Course Generation
- [x] Diagnostic Assessment
- [x] Learner Profiling
- [x] Multi-Agent Pipeline
- [x] 11-Language Narration
- [x] Interactive Lessons
- [x] Real-Time Pipeline
- [ ] Production Deployment
- [ ] Advanced Learner Analytics
- [ ] Mastery Tracking

---

## 👨‍💻 Author

<div align="center">

**Yash Jain**

Built with ❤️ using TanStack Start, Convex, Gemini & Sarvam AI

</div>

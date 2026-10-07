# DeHack MVP Iteration Document

## Product Chosen

CurriculumOS (Early MVP Phase)

This document summarizes the MVP journey using focused iterations, based on the implementation and handoff notes in this repository.

## 1. Problem Statement

Learners and educators need a fast way to turn a course topic into clear, personalized, and playable lesson content.  
The core problem is that traditional content generation pipelines are either too manual, not adaptive to learner level, or too weak in scene/audio synchronization for real lesson playback.

## 2. Initial Solution

The proposed solution was CurriculumOS, an AI-powered adaptive learning platform that:

- generates lesson plans and topic breakdowns
- creates narration and timing cues
- produces scene-ready output for interactive lesson playback

The initial design focused on proving that one pipeline could handle end-to-end lesson generation from a single input.

## 3. First MVP

The first MVP established a working multi-stage pipeline with core generation and storage.

- Bun + TanStack Start + Convex app foundation
- Stage-based pipeline (`plan`, `topic`, `tts`, `timing`, `scene`, `qa`)
- Sarvam TTS integration with Convex object storage for generated audio
- Retry/backoff and partial-failure handling for more reliable runs

The goal was to validate that complete lesson bundles could be generated consistently.

## Iteration 1: Pipeline Reliability and Production Behavior

Once basic generation worked, reliability became the first bottleneck.  
The team improved orchestration with controlled concurrency, retry policies, and deterministic status transitions.  
This reduced pipeline fragility and made failures observable by stage instead of silently failing whole runs.

## Iteration 2: Better Interactive Scene Input and Prompt Quality

Generated scenes were not consistently interactive enough, especially across multiple topics.  
The team added source animation block partitioning and upgraded prompts to preserve visual beats and interaction-friendly structure.  
Fallback scene output was upgraded from static cards to interactive HTML controls, making previews more useful even when model output degraded.

## Iteration 3: Adaptive Profiling and Personalized Course Planning

Generic lesson output was a learning-quality bottleneck.  
The product flow was redesigned into a wizard that starts from course topic, runs topic-specific diagnostics, and builds a learner profile before planning.  
This introduced `QuestionnaireAgent` and `ProfilerAgent`, letting course generation use evidence-based profile context rather than static assumptions.

## Iteration 4: SceneAgent Direct HTML Generation + Manual Prompt Testing

Template-like scene generation limited expressiveness.  
The scene path was upgraded so `SceneAgent` can generate full HTML scenes directly, with strict constraints for layout, interactivity, and offline-safe behavior.  
A `scene-gen` script was added for manual prompt testing and clipboard export, accelerating iteration speed for scene quality tuning.

## Iteration 5: Studio UX Cohesion and Course Summary Persistence

As capability increased, usability and continuity became the next bottleneck.  
The studio UI was updated to align with landing-page visual language and clearer step hierarchy.  
On the data side, `courseSummary` was added to profile persistence so learners and instructors can view saved course intent/pathway in the course detail route.

## 4. Current State

CurriculumOS has evolved from a basic generation pipeline into a more complete adaptive lesson system with:

- personalized pre-generation profiling
- stronger scene generation and fallback behavior
- persisted course profile + summary context

Each iteration addressed one clear bottleneck (reliability, interactivity quality, personalization, scene expressiveness, and UX/data continuity), resulting in a more robust MVP without over-expanding scope.

import { google } from '@ai-sdk/google'

function getDefaultGeminiModel() {
  return process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview'
}

function getPlannerModelName() {
  return process.env.GEMINI_MODEL_PLANNER ?? getDefaultGeminiModel()
}

function getProfilerModelName() {
  return process.env.GEMINI_MODEL_PROFILER ?? getPlannerModelName()
}

function getTopicModelName() {
  return process.env.GEMINI_MODEL_TOPIC ?? getDefaultGeminiModel()
}

function getQuestionnaireModelName() {
  return process.env.GEMINI_MODEL_QUESTIONNAIRE ?? getTopicModelName()
}

function getScriptModelName() {
  return process.env.GEMINI_MODEL_SCRIPT ?? getTopicModelName()
}

function getSceneModelName() {
  return process.env.GEMINI_MODEL_SCENE ?? getTopicModelName()
}

function getTranslatorModelName() {
  return process.env.GEMINI_MODEL_TRANSLATOR ?? getDefaultGeminiModel()
}

export function getPlannerModel() {
  return google(getPlannerModelName())
}

export function getProfilerModel() {
  return google(getProfilerModelName())
}

export function getTopicModel() {
  return google(getTopicModelName())
}

export function getQuestionnaireModel() {
  return google(getQuestionnaireModelName())
}

export function getScriptModel() {
  return google(getScriptModelName())
}

export function getSceneModel() {
  return google(getSceneModelName())
}

export function getTranslatorModel() {
  return google(getTranslatorModelName())
}

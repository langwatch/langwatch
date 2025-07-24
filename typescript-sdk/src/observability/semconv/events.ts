/*
  This file contains the values for the OpenTelemetry semantic conventions for GenAI log
  record event names.

  👉 https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
*/

export const LOG_EVNT_GEN_AI_SYSTEM_MESSAGE = "gen.ai.system_message";
export const LOG_EVNT_GEN_AI_USER_MESSAGE = "gen.ai.user_message";
export const LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE = "gen.ai.assistant_message";
export const LOG_EVNT_GEN_AI_TOOL_MESSAGE = "gen.ai.tool_message";
export const LOG_EVNT_GEN_AI_CHOICE = "gen.ai.choice";

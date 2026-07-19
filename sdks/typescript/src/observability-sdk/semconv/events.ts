/*
  This file contains the values for the OpenTelemetry semantic conventions for GenAI log
  record event names.

  👉 https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
*/

/**
 * GenAI system message event name
 * Used for log records representing system messages in AI conversations
 */
export const LOG_EVNT_GEN_AI_SYSTEM_MESSAGE = "gen.ai.system_message";

/**
 * GenAI user message event name
 * Used for log records representing user messages in AI conversations
 */
export const LOG_EVNT_GEN_AI_USER_MESSAGE = "gen.ai.user_message";

/**
 * GenAI assistant message event name
 * Used for log records representing assistant responses in AI conversations
 */
export const LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE = "gen.ai.assistant_message";

/**
 * GenAI tool message event name
 * Used for log records representing tool calls or responses in AI conversations
 */
export const LOG_EVNT_GEN_AI_TOOL_MESSAGE = "gen.ai.tool_message";

/**
 * GenAI choice event name
 * Used for log records representing choices made by AI models
 */
export const LOG_EVNT_GEN_AI_CHOICE = "gen.ai.choice";

/**
 * LangWatch LangChain callback event name
 * Used for log records representing LangChain callback events
 */
export const EVNT_LANGWATCH_LANGCHAIN_CALLBACK = "langwatch.langchain.callback";

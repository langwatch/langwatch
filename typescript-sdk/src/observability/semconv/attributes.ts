/*
  This file contains the semantic conventions for attributes either owned by LangWatch, or
  which are no yet part of the OpenTelemetry semantic conventions for Gen AI.

  Any that are not yet part of the OpenTelemetry semantic conventions for Gen AI are
  marked with an UNSTABLE_ prefix.
*/

export const ATTR_LANGWATCH_INPUT = "langwatch.input";
export const ATTR_LANGWATCH_OUTPUT = "langwatch.output";
export const ATTR_LANGWATCH_SPAN_TYPE = "langwatch.span.type";
export const ATTR_LANGWATCH_RAG_CONTEXTS = "langwatch.contexts";
export const ATTR_LANGWATCH_SDK_VERSION = "langwatch.sdk.version";
export const ATTR_LANGWATCH_SDK_NAME = "langwatch.sdk.name";
export const ATTR_LANGWATCH_SDK_LANGUAGE = "langwatch.sdk.language";
export const ATTR_LANGWATCH_TIMESTAMPS = "langwatch.timestamps";
export const ATTR_LANGWATCH_EVALUATION_CUSTOM = "langwatch.evaluation.custom";
export const ATTR_LANGWATCH_PARAMS = "langwatch.params";
export const ATTR_LANGWATCH_CUSTOMER_ID = "langwatch.customer.id";
export const ATTR_LANGWATCH_THREAD_ID = "langwatch.thread.id";
export const ATTR_LANGWATCH_STREAMING = "langwatch.gen_ai.streaming";
export const ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER =
  "langwatch.gen_ai.log_event.imposter";
export const ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY =
  "langwatch.gen_ai.log_event.body";

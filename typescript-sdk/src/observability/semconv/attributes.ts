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
export const ATTR_LANGWATCH_METRICS = "langwatch.metrics";
export const ATTR_LANGWATCH_SDK_VERSION = "langwatch.sdk.version";
export const ATTR_LANGWATCH_SDK_NAME = "langwatch.sdk.name";
export const ATTR_LANGWATCH_SDK_LANGUAGE = "langwatch.sdk.language";
export const ATTR_LANGWATCH_TIMESTAMPS = "langwatch.timestamps";
export const ATTR_LANGWATCH_EVALUATION_CUSTOM = "langwatch.evaluation.custom";
export const ATTR_LANGWATCH_PARAMS = "langwatch.params";
export const ATTR_LANGWATCH_CUSTOMER_ID = "langwatch.customer.id";
export const ATTR_LANGWATCH_THREAD_ID = "langwatch.thread.id";
export const ATTR_LANGWATCH_STREAMING = "langwatch.gen_ai.streaming";
export const ATTR_LANGWATCH_PROMPT_ID = "langwatch.prompt.id";
export const ATTR_LANGWATCH_PROMPT_VERSION_ID = "langwatch.prompt.version.id";
export const ATTR_LANGWATCH_PROMPT_VARIABLES = "langwatch.prompt.variables";
export const ATTR_LANGWATCH_PROMPT_SELECTED_ID = "langwatch.prompt.selected.id";
export const ATTR_LANGWATCH_PROMPT_VERSION_NUMBER =
  "langwatch.prompt.version.number";
export const ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER =
  "langwatch.gen_ai.log_event.imposter";
export const ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY =
  "langwatch.gen_ai.log_event.body";

  export const ATTR_LANGWATCH_LANGCHAIN_TAGS = "langwatch.langchain.tags";
  export const ATTR_LANGWATCH_LANGCHAIN_EVENT_NAME = "langwatch.langchain.event_name";
  export const ATTR_LANGWATCH_LANGCHAIN_RUN_ID = "langwatch.langchain.run.id";
  export const ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS = "langwatch.langchain.run.tags";
  export const ATTR_LANGWATCH_LANGCHAIN_RUN_TYPE = "langwatch.langchain.run.type";
  export const ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA = "langwatch.langchain.run.metadata";
  export const ATTR_LANGWATCH_LANGCHAIN_RUN_EXTRA_PARAMS = "langwatch.langchain.run.extra_params";
export const ATTR_LANGWATCH_LANGCHAIN_RUN_PARENT_ID =
  "langwatch.langchain.run.parent.id";

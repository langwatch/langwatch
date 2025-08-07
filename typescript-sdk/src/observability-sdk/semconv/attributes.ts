/*
  This file contains the semantic conventions for attributes either owned by LangWatch, or
  which are no yet part of the OpenTelemetry semantic conventions for Gen AI.

  Any that are not yet part of the OpenTelemetry semantic conventions for Gen AI are
  marked with an UNSTABLE_ prefix.
*/

/**
 * LangWatch input data attribute key
 * Used to store the input data for a span or event
 */
export const ATTR_LANGWATCH_INPUT = "langwatch.input";

/**
 * LangWatch output data attribute key
 * Used to store the output data for a span or event
 */
export const ATTR_LANGWATCH_OUTPUT = "langwatch.output";

/**
 * LangWatch span type attribute key
 * Used to identify the type of span being traced
 */
export const ATTR_LANGWATCH_SPAN_TYPE = "langwatch.span.type";

/**
 * LangWatch RAG contexts attribute key
 * Used to store retrieval-augmented generation contexts
 */
export const ATTR_LANGWATCH_RAG_CONTEXTS = "langwatch.contexts";

/**
 * LangWatch metrics attribute key
 * Used to store custom metrics data
 */
export const ATTR_LANGWATCH_METRICS = "langwatch.metrics";

/**
 * LangWatch SDK version attribute key
 * Used to track the version of the LangWatch SDK being used
 */
export const ATTR_LANGWATCH_SDK_VERSION = "langwatch.sdk.version";

/**
 * LangWatch SDK name attribute key
 * Used to identify the LangWatch SDK implementation
 */
export const ATTR_LANGWATCH_SDK_NAME = "langwatch.sdk.name";

/**
 * LangWatch SDK language attribute key
 * Used to identify the programming language of the SDK
 */
export const ATTR_LANGWATCH_SDK_LANGUAGE = "langwatch.sdk.language";

/**
 * LangWatch timestamps attribute key
 * Used to store timing information for events
 */
export const ATTR_LANGWATCH_TIMESTAMPS = "langwatch.timestamps";

/**
 * LangWatch custom evaluation attribute key
 * Used to store custom evaluation data
 */
export const ATTR_LANGWATCH_EVALUATION_CUSTOM = "langwatch.evaluation.custom";

/**
 * LangWatch parameters attribute key
 * Used to store parameter data for operations
 */
export const ATTR_LANGWATCH_PARAMS = "langwatch.params";

/**
 * LangWatch customer ID attribute key
 * Used to identify the customer associated with the trace
 */
export const ATTR_LANGWATCH_CUSTOMER_ID = "langwatch.customer.id";

/**
 * LangWatch thread ID attribute key
 * Used to group related operations within a conversation thread
 */
export const ATTR_LANGWATCH_THREAD_ID = "langwatch.thread.id";

/**
 * LangWatch streaming attribute key
 * Used to indicate if the operation involves streaming
 */
export const ATTR_LANGWATCH_STREAMING = "langwatch.gen_ai.streaming";

/**
 * LangWatch prompt ID attribute key
 * Used to identify the specific prompt being used
 */
export const ATTR_LANGWATCH_PROMPT_ID = "langwatch.prompt.id";

/**
 * LangWatch prompt version ID attribute key
 * Used to identify the specific version of a prompt
 */
export const ATTR_LANGWATCH_PROMPT_VERSION_ID = "langwatch.prompt.version.id";

/**
 * LangWatch prompt variables attribute key
 * Used to store variables used in prompt templates
 */
export const ATTR_LANGWATCH_PROMPT_VARIABLES = "langwatch.prompt.variables";

/**
 * LangWatch prompt selected ID attribute key
 * Used to identify which prompt was selected from a set
 */
export const ATTR_LANGWATCH_PROMPT_SELECTED_ID = "langwatch.prompt.selected.id";

/**
 * LangWatch prompt version number attribute key
 * Used to track the version number of a prompt
 */
export const ATTR_LANGWATCH_PROMPT_VERSION_NUMBER =
  "langwatch.prompt.version.number";

/**
 * LangWatch LangChain tags attribute key
 * Used to store tags associated with LangChain operations
 */
export const ATTR_LANGWATCH_LANGCHAIN_TAGS = "langwatch.langchain.tags";

/**
 * LangWatch LangChain event name attribute key
 * Used to identify the specific LangChain event type
 */
export const ATTR_LANGWATCH_LANGCHAIN_EVENT_NAME = "langwatch.langchain.event_name";

/**
 * LangWatch LangChain run ID attribute key
 * Used to identify a specific LangChain run
 */
export const ATTR_LANGWATCH_LANGCHAIN_RUN_ID = "langwatch.langchain.run.id";

/**
 * LangWatch LangChain run tags attribute key
 * Used to store tags associated with a LangChain run
 */
export const ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS = "langwatch.langchain.run.tags";

/**
 * LangWatch LangChain run type attribute key
 * Used to identify the type of LangChain run
 */
export const ATTR_LANGWATCH_LANGCHAIN_RUN_TYPE = "langwatch.langchain.run.type";

/**
 * LangWatch LangChain run metadata attribute key
 * Used to store metadata associated with a LangChain run
 */
export const ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA = "langwatch.langchain.run.metadata";

/**
 * LangWatch LangChain run extra parameters attribute key
 * Used to store additional parameters for a LangChain run
 */
export const ATTR_LANGWATCH_LANGCHAIN_RUN_EXTRA_PARAMS = "langwatch.langchain.run.extra_params";

/**
 * LangWatch LangChain run parent ID attribute key
 * Used to identify the parent run in a hierarchical structure
 */
export const ATTR_LANGWATCH_LANGCHAIN_RUN_PARENT_ID =
  "langwatch.langchain.run.parent.id";

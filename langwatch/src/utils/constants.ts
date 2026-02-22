export const DEFAULT_MODEL = "openai/gpt-5.2";

export const DEFAULT_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";

export const OPENAI_EMBEDDING_DIMENSION = 1536;

export const DEFAULT_TOPIC_CLUSTERING_MODEL = "openai/gpt-5.2";

export const KEY_CHECK = ["KEY", "GOOGLE_APPLICATION_CREDENTIALS"];

export const MASKED_KEY_PLACEHOLDER = "HAS_KEY••••••••••••••••••••••••";

export const DEFAULT_MAX_TOKENS = 64_000;

export const MIN_MAX_TOKENS = 256;

export const FALLBACK_MAX_TOKENS = 4096;

export const KSUID_RESOURCES = {
  BATCH_RESULT: "batchresult",
  COST: "cost",
  EVALUATION: "eval",
  EVALUATION_STATE: "evalstate",
  EVENT: "event",
  EXPERIMENT: "experiment",
  EXPERIMENT_RUN_RESULT: "exprunresult",
  MODEL_PROVIDER: "provider",
  MONITOR: "monitor",
  ORGANIZATION: "organization",
  PROJECT: "project",
  SCENARIO_BATCH: "scenariobatch",
  SPAN: "span",
  TRACE_SUMMARY: "tracesummary",
  TRACKED_EVENT: "trackedevent",
  USER: "user",
  PROMPT_PLAYGROUND_THREAD: "promptthread",
} as const;

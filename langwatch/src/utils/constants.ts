import { getLatestOpenAIChatFlagship } from "../server/modelProviders/getLatestFlagship";

// Auto-derived from the LLM model registry (llmModels.json) — always the
// newest plain `openai/gpt-<major>.<minor>` flagship. Hard fallback only
// for the unreachable case where the registry has no plain flagship.
export const DEFAULT_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";

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
  EVENT: "event",
  EXPERIMENT: "experiment",
  EXPERIMENT_RUN_RESULT: "exprunresult",
  MODEL_DEFAULT_CONFIG: "mdcfg",
  MODEL_DEFAULT_CONFIG_SCOPE: "mdcs",
  MODEL_PROVIDER: "provider",
  MODEL_PROVIDER_SCOPE: "mpscope",
  MONITOR: "monitor",
  ORGANIZATION: "organization",
  PROJECT: "project",
  SCENARIO: "scenario",
  SCENARIO_BATCH: "scenariobatch",
  SCENARIO_RUN: "scenariorun",
  SPAN: "span",
  TEAM: "team",
  LOG_RECORD: "logrecord",
  METRIC_RECORD: "metricrecord",
  TRACE_SUMMARY: "tracesummary",
  TRACKED_EVENT: "trackedevent",
  USER: "user",
  PROMPT_PLAYGROUND_THREAD: "promptthread",
  DATASET_RECORD: "dsrecord",
  GROUP: "group",
  ROLE_BINDING: "rolebinding",
  API_KEY_ROLE: "apikeyrole",
} as const;

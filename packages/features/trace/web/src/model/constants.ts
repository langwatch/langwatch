import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";

// Auto-derived from the LLM model registry (llmModels.json) — always the
// newest plain `openai/gpt-<major>.<minor>` flagship. Hard fallback only
// for the unreachable case where the registry has no plain flagship.
export const DEFAULT_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";

export const DEFAULT_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";

export const OPENAI_EMBEDDING_DIMENSION = 1536;

export const DEFAULT_TOPIC_CLUSTERING_MODEL = "openai/gpt-5.2";

/**
 * The credential fields that carry no secret, listed by exact name.
 *
 * Everything a provider stores in `customKeys` is treated as a secret unless
 * it appears here, so a provider that adds a field gets it masked with no
 * further action. The list holds connection configuration the settings form
 * has to render back to be editable: endpoints, API versions, regions, cloud
 * project and location pairs, and the `MANAGED` marker.
 *
 * Add a name here only after checking that its value cannot authenticate
 * anything. `modelProviderHelpers.isSecretCredentialField` is the single
 * reader, and `credentialFieldClassification.unit.test.ts` walks the provider
 * registry to keep this list and the registry in step.
 */
export const PUBLIC_CREDENTIAL_FIELDS: ReadonlySet<string> = new Set([
  "ANTHROPIC_BASE_URL",
  "AWS_REGION_NAME",
  "AZURE_API_GATEWAY_BASE_URL",
  "AZURE_API_GATEWAY_VERSION",
  "AZURE_CONTENT_SAFETY_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_ENDPOINT",
  "CUSTOM_BASE_URL",
  "GEMINI_LOCATION",
  "GEMINI_PROJECT",
  "GOOGLE_AGENT_PLATFORM_LOCATION",
  "GOOGLE_AGENT_PLATFORM_PROJECT",
  "MANAGED",
  "OPENAI_BASE_URL",
  "VERTEXAI_LOCATION",
  "VERTEXAI_PROJECT",
]);

/**
 * Name fragments that mark a field as a credential whatever else is decided
 * about it. A field matching one of these can never be added to
 * `PUBLIC_CREDENTIAL_FIELDS`; the classification test enforces that, so an
 * allowlist entry cannot re-expose a secret by mistake.
 */
export const SECRET_CREDENTIAL_MARKERS = [
  "KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "CREDENTIAL",
] as const;

export const MASKED_KEY_PLACEHOLDER = "HAS_KEY••••••••••••••••••••••••";

/**
 * Hard cap on a single translate-to-English request, enforced by the
 * router's input schema and pre-applied by clients (slice before send).
 * Keeps a multi-MB trace payload from becoming one prompt — context-limit
 * failure or a surprise bill.
 */
export const TRANSLATE_TEXT_MAX_CHARS = 100_000;

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
  TRIGGER: "trigger",
  LOG_RECORD: "logrecord",
  TRACE_SUMMARY: "tracesummary",
  TRACKED_EVENT: "trackedevent",
  USER: "user",
  PROMPT_PLAYGROUND_THREAD: "promptthread",
  DATASET_RECORD: "dsrecord",
  GROUP: "group",
  ROLE_BINDING: "rolebinding",
  API_KEY_ROLE: "apikeyrole",
  BUG_REPORT: "bugreport",
  LANGY_CONVERSATION: "langyconv",
  LANGY_MESSAGE: "langymsg",
  TOPIC_CLUSTERING_RUN: "topicrun",
  TOPIC_CLUSTERING_RUN_HISTORY: "topicrunhist",
  TOPIC_MODEL_PROJECTION: "topicmodel",
  PROCESS_MANAGER_INSTANCE: "pminstance",
  PROCESS_MANAGER_INBOX: "pminbox",
  PROCESS_MANAGER_OUTBOX: "pmoutbox",
  WEBHOOK_ENDPOINT: "webhookendpoint",
  EXPORT: "export",
  TRACE_EDIT_OVERLAY: "traceedit",
} as const;

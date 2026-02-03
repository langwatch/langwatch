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
  // Core auth
  ACCOUNT: "account",
  SESSION: "session",
  USER: "user",

  // Organization
  ORGANIZATION: "organization",
  ORG_INVITE: "orginvite",
  ORG_USER: "orguser",
  ORG_FEATURE: "orgfeature",

  // Team
  TEAM: "team",
  TEAM_USER: "teamuser",

  // Project
  PROJECT: "project",
  MODEL_PROVIDER: "modelprovider",
  AGENT: "agent",
  EVALUATOR: "evaluator",
  SCENARIO: "scenario",

  // Monitoring
  MONITOR: "monitor",
  COST: "cost",
  TRIGGER: "trigger",
  TRIGGER_SENT: "triggersent",

  // Data
  TOPIC: "topic",
  DATASET: "dataset",
  DATASET_RECORD: "datasetrecord",
  CUSTOM_GRAPH: "customgraph",
  DASHBOARD: "dashboard",

  // Evaluation
  EXPERIMENT: "experiment",
  BATCH_EVALUATION: "batcheval",
  EVALUATION: "eval",

  // Annotation
  ANNOTATION: "annotation",
  ANNOTATION_SCORE: "annotationscore",
  ANNOTATION_QUEUE: "annotationqueue",
  ANNOTATION_QUEUE_ITEM: "annotationqueueitem",

  // Workflow
  WORKFLOW: "workflow",
  WORKFLOW_VERSION: "workflowversion",

  // Other
  PUBLIC_SHARE: "publicshare",
  CUSTOM_LLM_MODEL_COST: "customllmmodelcost",
  PROMPT_CONFIG: "promptconfig",
  PROMPT_CONFIG_VERSION: "promptconfigversion",
  ANALYTICS: "analytics",
  CUSTOM_ROLE: "customrole",
  NOTIFICATION: "notification",

  // Event sourcing specific
  EVENT: "event",
  SPAN: "span",
  TRACE_SUMMARY: "tracesummary",
  TRACKED_EVENT: "trackedevent",
} as const;

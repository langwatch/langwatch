import type { WorkflowVersion } from "@prisma/client";

type AnyJSONDumpedClass = {
  __class__?: string;
} & Record<string, any>;

type DSPyTrace = {
  input: AnyJSONDumpedClass;
  pred: AnyJSONDumpedClass;
};

export type DSPyExample = {
  hash: string;
  example: AnyJSONDumpedClass;
  pred: AnyJSONDumpedClass;
  score: number;
  trace?: DSPyTrace[] | null;
};

export type DSPyLLMCall = {
  hash: string;
  __class__: string;
  response: AnyJSONDumpedClass;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cost?: number | null;
};

export type DSPyOptimizer = {
  name: string;
  parameters: Record<string, any>;
};

export type DSPyPredictor = {
  name: string;
  predictor: AnyJSONDumpedClass;
};

export type DSPyStep = {
  project_id: string;
  run_id: string;
  workflow_version_id?: string | null;
  experiment_id: string;
  index: string;
  score: number;
  label: string;
  optimizer: DSPyOptimizer;
  predictors: DSPyPredictor[];
  examples: DSPyExample[];
  llm_calls: DSPyLLMCall[];
  timestamps: {
    created_at: number;
    inserted_at: number;
    updated_at: number;
  };
};

export type DSPyStepRESTParams = Omit<
  DSPyStep,
  "timestamps" | "project_id" | "experiment_id" | "examples" | "llm_calls"
> & {
  experiment_id?: string | null;
  experiment_slug?: string | null;
  timestamps: {
    created_at: number;
  };
  examples: Omit<DSPyExample, "hash">[];
  llm_calls: Omit<DSPyLLMCall, "hash">[];
};

export type DSPyStepSummary = {
  run_id: string;
  index: string;
  score: number;
  label: string;
  optimizer: {
    name: string;
  };
  llm_calls_summary: {
    total: number;
    total_tokens: number;
    total_cost: number;
  };
  timestamps: {
    created_at: number;
  };
};

export type DSPyRunsSummary = {
  runId: string;
  workflow_version?: WorkflowVersion;
  steps: DSPyStepSummary[];
  created_at: number;
};

/**
 * Valid target types for batch evaluations.
 * - prompt: LLM prompt target from Evaluations V3
 * - agent: Agent target from Evaluations V3
 * - custom: External target from API (Python SDK, etc.)
 */
export type ESBatchEvaluationTargetType = "prompt" | "agent" | "custom";

/**
 * Target metadata stored in batch evaluation for Evaluations V3.
 * Captures the state of targets at execution time so we can display
 * results even after targets are modified or deleted.
 */
export type ESBatchEvaluationTarget = {
  id: string;
  name: string;
  type: ESBatchEvaluationTargetType;
  /** For prompt targets: the prompt config ID */
  prompt_id?: string | null;
  /** For prompt targets: the specific version used */
  prompt_version?: number | null;
  /** For agent targets: the agent ID */
  agent_id?: string | null;
  /** Model used (for prompt targets) */
  model?: string | null;
  /** Flexible metadata for comparison and analysis (model name, temperature, etc.) */
  metadata?: Record<string, string | number | boolean> | null;
};

export type ESBatchEvaluation = {
  project_id: string;
  experiment_id: string;
  run_id: string;
  workflow_version_id?: string | null;
  progress?: number | null;
  total?: number | null;
  /** For Evaluations V3: stores target configurations at execution time */
  targets?: ESBatchEvaluationTarget[] | null;
  dataset: {
    index: number;
    /** For Evaluations V3: identifies which target produced this result */
    target_id?: string | null;
    entry: Record<string, any>;
    predicted?: Record<string, any>;
    cost?: number | null;
    duration?: number | null;
    error?: string | null;
    trace_id?: string | null;
  }[];
  evaluations: {
    evaluator: string;
    name?: string | null;
    /** For Evaluations V3: identifies which target this evaluation is for */
    target_id?: string | null;
    status: "processed" | "skipped" | "error";
    index: number;
    duration?: number | null;
    inputs?: Record<string, any>;
    score?: number | null;
    label?: string | null;
    passed?: boolean | null;
    details?: string | null;
    cost?: number | null;
  }[];
  timestamps: {
    created_at: number;
    inserted_at: number;
    updated_at: number;
    stopped_at?: number | null;
    finished_at?: number | null;
  };
};

/**
 * Target in REST API params - type is optional as it can be
 * extracted from metadata or defaulted to "custom"
 */
export type ESBatchEvaluationTargetREST = Omit<ESBatchEvaluationTarget, "type"> & {
  type?: ESBatchEvaluationTargetType;
};

export type ESBatchEvaluationRESTParams = Omit<
  Partial<ESBatchEvaluation>,
  "project_id" | "experiment_id" | "timestamps" | "targets"
> & {
  experiment_id?: string | null;
  experiment_slug?: string | null;
  run_id: string | null;
  workflow_id?: string | null;
  name?: string | null;
  targets?: ESBatchEvaluationTargetREST[] | null;
  timestamps?: {
    created_at?: number | null;
    finished_at?: number | null;
    stopped_at?: number | null;
  };
};

export type AppliedOptimization = {
  id: string;
  instructions?: string;
  fields?: AppliedOptimizationField[];
  demonstrations?: Record<string, any>[];
};

export type AppliedOptimizationField = {
  identifier: string;
  field_type: "input" | "output";
  prefix?: string;
  desc?: string;
};

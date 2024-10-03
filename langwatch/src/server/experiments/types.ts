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
  experiment_slug: string;
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

export type ESBatchEvaluation = {
  project_id: string;
  experiment_id: string;
  run_id: string;
  workflow_version_id?: string | null;
  progress?: number | null;
  total?: number | null;
  dataset: {
    index: number;
    entry: Record<string, any>;
    cost?: number | null;
    duration?: number | null;
    error?: string | null;
  }[];
  evaluations: {
    evaluator: string;
    name?: string | null;
    status: "processed" | "skipped" | "error";
    index: number;
    duration?: number | null;
    inputs: Record<string, any>;
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

export type ESBatchEvaluationRESTParams = Omit<
  Partial<ESBatchEvaluation>,
  "project_id" | "experiment_id" | "timestamps"
> & {
  experiment_slug: string;
  run_id: string | null;
  workflow_id?: string | null;
  name?: string | null;
  timestamps?: {
    created_at?: number | null;
    finished_at?: number | null;
    stopped_at?: number | null;
  };
};

export type AppliedOptimization = {
  id: string;
  prompt?: string;
  fields?: AppliedOptimizationField[];
  demonstrations?: Record<string, any>[];
};

export type AppliedOptimizationField = {
  identifier: string;
  field_type: "input" | "output";
  prefix?: string;
  desc?: string;
};

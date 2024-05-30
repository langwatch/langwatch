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
  steps: DSPyStepSummary[];
  created_at: number;
};

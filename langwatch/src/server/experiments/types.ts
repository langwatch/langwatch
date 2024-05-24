type AnyJSONDumpedClass = {
  __class__?: string;
} & Record<string, any>;

type DSPyTrace = {
  input: AnyJSONDumpedClass;
  pred: AnyJSONDumpedClass;
};

type DSPyExample = {
  example: AnyJSONDumpedClass;
  pred: AnyJSONDumpedClass;
  result: boolean;
  trace: DSPyTrace[];
};

type DSPyLLMCall = {
  __class__: string;
  response: AnyJSONDumpedClass;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  tokens_estimated?: boolean | null;
  cost?: number | null;
};

export type DSPyStep = {
  project_id: string;
  run_id: string;
  parameters_hash: string;
  experiment_id: string;
  index: number;
  parameters: AnyJSONDumpedClass[];
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
  "timestamps" | "project_id" | "experiment_id"
> & {
  experiment_slug: string;
  timestamps: {
    created_at: number;
  };
};

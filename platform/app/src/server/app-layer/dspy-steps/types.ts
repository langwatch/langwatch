export interface DspyExampleData {
  hash: string;
  example: Record<string, unknown>;
  pred: Record<string, unknown>;
  score: number;
  trace?: Array<{
    input: Record<string, unknown>;
    pred: Record<string, unknown>;
  }> | null;
}

export interface DspyLlmCallData {
  hash: string;
  __class__: string;
  response: Record<string, unknown>;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cost?: number | null;
}

export interface DspyPredictorData {
  name: string;
  predictor: Record<string, unknown>;
}

export interface DspyStepData {
  tenantId: string;
  experimentId: string;
  runId: string;
  stepIndex: string;
  workflowVersionId?: string | null;
  score: number;
  label: string;
  optimizerName: string;
  optimizerParameters: Record<string, unknown>;
  predictors: DspyPredictorData[];
  examples: DspyExampleData[];
  llmCalls: DspyLlmCallData[];
  createdAt: number;
  insertedAt: number;
  updatedAt: number;
}

export interface DspyStepSummaryData {
  tenantId: string;
  experimentId: string;
  runId: string;
  stepIndex: string;
  workflowVersionId?: string | null;
  score: number;
  label: string;
  optimizerName: string;
  llmCallsTotal: number;
  llmCallsTotalTokens: number;
  llmCallsTotalCost: number;
  createdAt: number;
}

import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";

export interface LangEvalsEvaluateParams {
  evaluatorType: string;
  data: Record<string, unknown>;
  settings: Record<string, unknown>;
  env: Record<string, string>;
  idempotencyKey?: string;
}

export interface LangEvalsClient {
  evaluate(params: LangEvalsEvaluateParams): Promise<SingleEvaluationResult>;
}

export class NullLangevalsClient implements LangEvalsClient {
  async evaluate(): Promise<SingleEvaluationResult> {
    return { status: "skipped", details: "Langevals client not available" };
  }
}

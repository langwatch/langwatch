import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { EvaluationLangevals } from "../app/evaluation.members.ts";

/** Null object used by self-hosted deployments without a Langevals endpoint. */
export class NullLangevalsEvaluatorClient implements EvaluationLangevals {
  async evaluate(): Promise<SingleEvaluationResult> {
    return { status: "skipped", details: "Langevals client not available" };
  }
}

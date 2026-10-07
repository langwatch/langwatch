import type { InstantEvalJudgeProjectRepository } from "./instant-eval-judge-project.repository.ts";
import type { InstantEvalJudgeSpendRepository } from "./instant-eval-judge-spend.repository.ts";
import type { InstantEvalJudgeUsageBillingRepository } from "./instant-eval-judge-usage-billing.repository.ts";

/** The judge's own copies of the facts it checks before each call (ADR-174 Schema). */
export interface InstantEvalJudgeRepositories {
  readonly projects: InstantEvalJudgeProjectRepository;
  readonly usageBilling: InstantEvalJudgeUsageBillingRepository;
  readonly spend: InstantEvalJudgeSpendRepository;
}

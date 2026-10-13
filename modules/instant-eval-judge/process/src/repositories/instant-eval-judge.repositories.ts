import type { InstantEvalJudgeProjectRepository } from "./instant-eval-judge-placement.repository.ts";
import type { InstantEvalJudgeSpendRepository } from "./instant-eval-judge-spend.repository.ts";
import type { InstantEvalJudgeUsageBillingRepository } from "./instant-eval-judge-usage-billing.repository.ts";
import type { InstantEvalRateLimitRepository } from "./instant-eval-rate-limit.repository.ts";

/**
 * What the judge checks before each call: project placement read from its owners (R40), its
 * own billing copy and spend (ADR-174 Schema), and the cloud classifier's shared token buckets.
 */
export interface InstantEvalJudgeRepositories {
  readonly projects: InstantEvalJudgeProjectRepository;
  readonly usageBilling: InstantEvalJudgeUsageBillingRepository;
  readonly spend: InstantEvalJudgeSpendRepository;
  readonly rateLimits: InstantEvalRateLimitRepository;
}

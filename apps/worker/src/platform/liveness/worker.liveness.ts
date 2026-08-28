import { z } from "zod";

export const WORKER_LIVENESS_PATH = "/healthz";

const workerLivenessPolicySchema = z.object({
  stallBudgetMs: z.number().int().nonnegative(),
});

export type WorkerLivenessPolicy = z.infer<typeof workerLivenessPolicySchema>;

export function createWorkerLivenessPolicy(input: unknown): WorkerLivenessPolicy {
  return workerLivenessPolicySchema.parse(input);
}

export function isWorkerHeartbeatLive(input: {
  observedAtMs: number;
  nowMs: number;
  policy: WorkerLivenessPolicy;
}): boolean {
  return input.nowMs - input.observedAtMs <= input.policy.stallBudgetMs;
}

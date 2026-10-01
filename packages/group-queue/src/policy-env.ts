import {
  nonNegativeSafeIntegerOrUndefined,
  positiveSafeIntegerOrUndefined,
} from "@langwatch/config";

import type { GroupQueuePolicy } from "./contracts.ts";

/**
 * Env-string shape for GroupQueuePolicy; each process defines its projection
 * and passes unparsed numeric fields for this package to validate and parse.
 */
export interface GroupQueuePolicyEnvInputs {
  globalConcurrency?: string;
  tenantConcurrencyCap?: string;
  globalConcurrencyBudget?: string;
  zstdWritesEnabled?: string;
  msgpackWritesEnabled?: string;
}

/**
 * Build a `GroupQueuePolicy` from a process's env projection. One place per
 * process; a new policy field lands in one map instead of drifting across N
 * copies. Callers can override any resolved field by merging afterwards.
 */
export function resolveGroupQueuePolicyFromEnv(
  inputs: GroupQueuePolicyEnvInputs,
): GroupQueuePolicy {
  return {
    globalConcurrency: positiveSafeIntegerOrUndefined(inputs.globalConcurrency),
    tenantConcurrencyCap: nonNegativeSafeIntegerOrUndefined(inputs.tenantConcurrencyCap),
    globalConcurrencyBudget: nonNegativeSafeIntegerOrUndefined(inputs.globalConcurrencyBudget),
    compression: inputs.zstdWritesEnabled === "true" ? "zstd" : "gzip",
    payloadCodec: inputs.msgpackWritesEnabled === "true" ? "msgpack" : "json",
  };
}

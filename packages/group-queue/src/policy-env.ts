import {
  nonNegativeSafeIntegerOrUndefined,
  positiveSafeIntegerOrUndefined,
} from "@langwatch/config";
import type { GroupQueuePolicy } from "./contracts";

/**
 * The env-string shape both API and worker (and any future process) hand this
 * package to build a `GroupQueuePolicy`. Structural on purpose: every process
 * defines its own env projection, and this port takes the slice of it group
 * queue reads — never the whole thing.
 *
 * Numeric fields are unparsed env strings: this package owns the parse so a
 * `"NaN"` or a negative never reaches the policy.
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

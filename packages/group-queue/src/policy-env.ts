import {
  nonNegativeSafeIntegerOrUndefined,
  positiveSafeIntegerOrUndefined,
} from "@langwatch/config";

import type { GroupQueuePolicy } from "./contracts.ts";
import { GROUP_QUEUE_CONFIG } from "./groupQueue.ts";

/**
 * Env-string shape for GroupQueuePolicy; each process defines its projection
 * and passes unparsed numeric fields for this package to validate and parse.
 */
export interface GroupQueuePolicyEnvInputs {
  globalConcurrency?: string;
  /** Most slots adaptation may reach; must be at least the configured concurrency. */
  adaptiveSlotsCeiling?: string;
  tenantConcurrencyCap?: string;
  globalConcurrencyBudget?: string;
  settleWindowMs?: string;
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
  const globalConcurrency = positiveSafeIntegerOrUndefined(inputs.globalConcurrency);
  const ceiling = positiveSafeIntegerOrUndefined(inputs.adaptiveSlotsCeiling);
  const floor = globalConcurrency ?? GROUP_QUEUE_CONFIG.defaultGlobalConcurrency;
  return {
    globalConcurrency,
    adaptiveSlotsCeiling: ceiling !== undefined && ceiling >= floor ? ceiling : undefined,
    tenantConcurrencyCap: nonNegativeSafeIntegerOrUndefined(inputs.tenantConcurrencyCap),
    globalConcurrencyBudget: nonNegativeSafeIntegerOrUndefined(inputs.globalConcurrencyBudget),
    settleWindowMs: nonNegativeSafeIntegerOrUndefined(inputs.settleWindowMs),
    compression: inputs.zstdWritesEnabled === "true" ? "zstd" : "gzip",
    payloadCodec: inputs.msgpackWritesEnabled === "true" ? "msgpack" : "json",
  };
}

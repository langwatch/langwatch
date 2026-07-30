import { renderGroupKey, type GroupKey } from "@langwatch/event-sourcing";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "./process-managers/triggerSettlement";

/**
 * This pipeline's dispatch-plane lanes (ADR-100). One place builds every
 * `GroupKey` descriptor this pipeline uses; `renderGroupKey` — the package's
 * own renderer, never a hand-written template literal — is the only thing
 * that turns one into a wire string. `pipeline.ts` is the consumer: every
 * mount point below is attached to a command or process-manager registration
 * there, not left as an unused export.
 */

const AGGREGATE_TYPE = "trigger";

/**
 * A `__global__` tenant marker, not a real tenant id — matches the
 * convention the old pipeline already used for its two schedule-only,
 * cross-tenant processes. ADR-100's `GroupKey.tenantId` is always present so
 * no scope can accidentally place two tenants' work in one lane; a singleton
 * process by definition has no owning tenant, so it needs an explicit,
 * unmistakable placeholder rather than an empty string or `null`.
 */
export const GLOBAL_TENANT = "__global__";

/**
 * `recordMatch` command lane. ADR-100 decision 4: a command lane declares
 * `scope: aggregate` and the command's own name plays no part in the lane
 * identity — every command type for one trigger serialises into a single
 * lane. This replaces the old pipeline's `serializeByAggregate: true` flag,
 * which ADR-100 removes as an option precisely because the descriptor makes
 * the same pairing structural instead of an opt-in a caller could forget.
 */
export function recordMatchGroupKey(params: {
  tenantId: string;
  triggerId: string;
}): GroupKey {
  return {
    tenantId: params.tenantId,
    lane: { kind: "command" },
    scope: {
      kind: "aggregate",
      aggregateType: AGGREGATE_TYPE,
      aggregateId: params.triggerId,
    },
  };
}

/**
 * The `triggerSettlement` process manager is keyed one instance per trigger —
 * `scope: aggregate` mirrors the `trigger` aggregate 1:1, because the whole
 * job of this process is to accumulate ONE trigger's pending matches. Two
 * triggers matching the same trace must never share a lane (their settle
 * windows, caps and send claims are independent), which is exactly what
 * scoping on the trigger id rather than the trace id gives.
 */
export function triggerSettlementGroupKey(params: {
  tenantId: string;
  triggerId: string;
}): GroupKey {
  return {
    tenantId: params.tenantId,
    // The lane name is the process's own declared name, imported — never
    // retyped as a literal that could drift from `triggerSettlementDefinition.name`.
    lane: { kind: "processManager", name: TRIGGER_SETTLEMENT_PROCESS_NAME },
    scope: {
      kind: "aggregate",
      aggregateType: AGGREGATE_TYPE,
      aggregateId: params.triggerId,
    },
  };
}

/**
 * `graphAlertSweep` and `webhookDeliveryPrune` are singleton, schedule-only
 * processes with no owning aggregate — one instance for the whole
 * deployment, waking on a fixed interval rather than in response to any
 * trigger's events. `scope: global` is the one scope ADR-100 says must be
 * "written out" rather than defaulted to, because it serialises everything
 * sharing the lane through one queue; that is correct here (there is
 * genuinely only one sweep, one prune) and would be wrong for almost
 * anything else, which is the point of making it explicit.
 */
export function singletonProcessManagerGroupKey(processName: string): GroupKey {
  return {
    tenantId: GLOBAL_TENANT,
    lane: { kind: "processManager", name: processName },
    scope: { kind: "global" },
  };
}

/**
 * The wire form of a descriptor — what a queue actually keys work on.
 * `renderGroupKey` (`@langwatch/event-sourcing/dispatch/groupKey`) owns
 * escaping and Redis Cluster hash-tag placement; nothing in this pipeline
 * builds that string by hand.
 */
export function renderRecordMatchGroupKey(params: {
  tenantId: string;
  triggerId: string;
}): string {
  return renderGroupKey(recordMatchGroupKey(params));
}

export function renderTriggerSettlementGroupKey(params: {
  tenantId: string;
  triggerId: string;
}): string {
  return renderGroupKey(triggerSettlementGroupKey(params));
}

export function renderSingletonProcessManagerGroupKey(processName: string): string {
  return renderGroupKey(singletonProcessManagerGroupKey(processName));
}

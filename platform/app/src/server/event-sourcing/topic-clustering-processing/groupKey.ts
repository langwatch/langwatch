import type { GroupKey } from "@langwatch/event-sourcing";

/**
 * This pipeline's dispatch-plane lanes (ADR-100). One place names every lane
 * `topic-clustering-processing` uses — a typed `{tenantId, lane, scope}`
 * descriptor per lane, rendered by `@langwatch/event-sourcing`'s
 * `renderGroupKey`, never a hand-concatenated string. Mirrors
 * `log-processing/groupKey.ts` and `automations/groupKeys.ts`, the
 * established shape for this file across every converted pipeline.
 */

const AGGREGATE_TYPE = "topic_clustering";

/**
 * The command lane: every command for one project serialises into a single
 * lane (ADR-100 decision 4 — a command lane declares `scope: aggregate` and
 * the command's own name plays no part in the lane identity; this replaces
 * the old pipeline's opt-in `serializeByAggregate: true`, which ADR-100
 * removes as an option because the descriptor makes the pairing structural).
 */
export function topicClusteringCommandGroupKey(params: {
  tenantId: string;
}): GroupKey {
  return {
    tenantId: params.tenantId,
    lane: { kind: "command" },
    scope: {
      kind: "aggregate",
      aggregateType: AGGREGATE_TYPE,
      aggregateId: params.tenantId,
    },
  };
}

/**
 * A fold's lane: `scope: aggregate` is not a choice here — ADR-106's
 * checker refuses any other scope for a fold (`fold-scope-must-be-aggregate`),
 * because a fold reads its prior state and writes it back, and two lanes
 * touching one aggregate would race that read-modify-write cycle.
 */
function foldGroupKey(name: string, tenantId: string): GroupKey {
  return {
    tenantId,
    lane: { kind: "fold", name },
    scope: {
      kind: "aggregate",
      aggregateType: AGGREGATE_TYPE,
      aggregateId: tenantId,
    },
  };
}

export function topicClusteringRunStatusGroupKey(params: {
  tenantId: string;
}): GroupKey {
  return foldGroupKey("topicClusteringRunStatus", params.tenantId);
}

export function topicClusteringRunHistoryGroupKey(params: {
  tenantId: string;
}): GroupKey {
  return foldGroupKey("topicClusteringRunHistory", params.tenantId);
}

export function topicModelGroupKey(params: { tenantId: string }): GroupKey {
  return foldGroupKey("topicModel", params.tenantId);
}

/**
 * The `topicClustering` process manager's lane: one instance per project,
 * `scope: aggregate` mirroring the `topic_clustering` aggregate 1:1 — the
 * same shape `triggerSettlementGroupKey` uses for the identical reason (the
 * whole job of this process is to own ONE project's run lifecycle, so two
 * lanes for the same project must never exist).
 */
export function topicClusteringProcessGroupKey(params: {
  tenantId: string;
}): GroupKey {
  return {
    tenantId: params.tenantId,
    lane: { kind: "processManager", name: "topicClustering" },
    scope: {
      kind: "aggregate",
      aggregateType: AGGREGATE_TYPE,
      aggregateId: params.tenantId,
    },
  };
}

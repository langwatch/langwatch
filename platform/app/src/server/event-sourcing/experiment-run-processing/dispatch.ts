import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";

/**
 * Two lanes, two scopes (ADR-100 decision 2): scope is the ordering contract
 * and the batching contract at once.
 *
 * The fold is scoped to the aggregate — one lane per run — because two
 * concurrent applies to one run's row would race the read-modify-write cycle.
 * The item map is scoped narrower, one lane per dataset row, so an entry's
 * target and evaluator results coalesce into a single insert.
 */
export function experimentRunStateGroupKey(args: {
  readonly tenantId: string;
  readonly aggregateId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "experimentRunState" },
    scope: {
      kind: "aggregate",
      aggregateType: "experiment_run",
      aggregateId: args.aggregateId,
    },
  };
}

export function renderExperimentRunStateGroupKey(args: {
  readonly tenantId: string;
  readonly aggregateId: string;
}): string {
  return renderGroupKey(experimentRunStateGroupKey(args));
}

export function experimentRunItemsGroupKey(args: {
  readonly tenantId: string;
  readonly experimentId: string;
  readonly runId: string;
  readonly index: number;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "experimentRunItems" },
    scope: {
      kind: "partition",
      parts: [args.experimentId, args.runId, String(args.index)],
    },
  };
}

export function renderExperimentRunItemsGroupKey(args: {
  readonly tenantId: string;
  readonly experimentId: string;
  readonly runId: string;
  readonly index: number;
}): string {
  return renderGroupKey(experimentRunItemsGroupKey(args));
}

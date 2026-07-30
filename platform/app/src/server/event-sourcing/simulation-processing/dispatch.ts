import { type GroupKey, renderGroupKey } from "@langwatch/event-sourcing";

/**
 * The `simulationRunState` fold's lane (ADR-100), keyed on `scenarioRunId`
 * alone. A lane shared by two runs races their read-modify-write cycles and
 * loses an update no read-time dedup recovers, which is why a fold's scope is
 * always the aggregate — the signature has nowhere to pass a batch or set id.
 */
export function simulationRunFoldGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "simulationRunState" },
    scope: {
      kind: "aggregate",
      aggregateType: "simulation_run",
      aggregateId: args.scenarioRunId,
    },
  };
}

export function renderSimulationRunFoldGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): string {
  return renderGroupKey(simulationRunFoldGroupKey(args));
}

/**
 * The message map's lane. A map holds no accumulator, so its lane exists to
 * coalesce one run's messages into a single insert rather than to serialise
 * anything.
 */
export function simulationRunMessagesGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "simulationRunMessages" },
    scope: { kind: "partition", parts: [args.scenarioRunId] },
  };
}

export function renderSimulationRunMessagesGroupKey(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): string {
  return renderGroupKey(simulationRunMessagesGroupKey(args));
}

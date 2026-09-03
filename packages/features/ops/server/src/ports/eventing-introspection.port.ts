/**
 * The live pipeline surface the ops explorers read.
 *
 * The application derived these off a module-global registry backed by
 * `getApp().eventSourcing.definitions`; a package may not reach a process
 * global, so the walk is an adapter over the definitions the composition
 * already holds and this is the seam the explorers take.
 */
export interface OpsProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map" | "state";
}

export interface OpsProcessManagerMetadata {
  processName: string;
  pipelineName: string;
  aggregateType: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /**
   * Intent types the machine can emit — its cross-aggregate commands,
   * dispatched through the transactional outbox.
   */
  intentTypes: string[];
  /**
   * True for a fixed-interval singleton (one instance, project `__global__`);
   * false for a per-aggregate machine keyed by aggregate id.
   */
  scheduled: boolean;
  /** Fixed wake interval in ms for a scheduled singleton, else null. */
  everyMs: number | null;
  /** True when the machine computes its own wake-ups from within `evolve`. */
  hasWake: boolean;
}

export interface OpsDejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

export abstract class OpsEventingIntrospectionPort {
  /** Every fold, map and state projection mounted across the pipelines. */
  abstract projections(): OpsProjectionMetadata[];

  /** The process-manager state machines mounted across the pipelines. */
  abstract processManagers(): OpsProcessManagerMetadata[];

  /**
   * The fold projections a DejaView replay can re-run in memory, carrying
   * their `init`/`apply` so the explorer can rebuild state without a store.
   */
  abstract dejaViewProjections(): OpsDejaViewProjection[];
}

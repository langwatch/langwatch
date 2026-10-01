import type { Event } from "../domain/types.ts";
import type {
  SealedFoldProjection,
  SealedMapProjection,
  SealedStateProjection,
} from "../projections/sealedProjection.ts";
import type { RetentionPolicyResolver } from "../runtime.types.ts";
import type { DiscoveredAggregate, ReplayEventSource } from "./replayEventSource.ts";
import type { ReplayRedis } from "./replayRedis.ts";

export interface RegisteredFoldProjection extends SealedFoldProjection<Event> {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  /**
   * Pause-set entry consumed by the GroupQueue Lua dispatcher. Folds are
   * enqueued as `__jobType=projection`, so this is `{pipeline}/projection/{name}`.
   */
  pauseKey: string;
  kind: "fold";
  /** ClickHouse table name for OPTIMIZE after replay. Omit for non-CH stores. */
  targetTable?: string;
}

export interface RegisteredMapProjection extends SealedMapProjection<Event> {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  /**
   * Pause-set entry consumed by the GroupQueue Lua dispatcher. Maps are
   * enqueued as `__jobType=handler`, so this is `{pipeline}/handler/{name}`.
   */
  pauseKey: string;
  kind: "map";
  /** ClickHouse table name for OPTIMIZE after replay. Omit for non-CH stores. */
  targetTable?: string;
}

/**
 * A Postgres operational state projection registered for a canonical rebuild.
 * Unlike fold/map, replay rebuilds its `StateProjectionStore` from `init()`
 * (never `store.load`); re-running is idempotent since the output is deterministic.
 */
export interface RegisteredStateProjection extends SealedStateProjection<Event> {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  /**
   * Pause-set entry for parity/introspection. State projections enqueue as
   * `__jobType=stateProjection`, so this is `{pipeline}/stateProjection/{name}`.
   * The normal rebuild path consumes it to pause live writes.
   */
  pauseKey: string;
  kind: "state";
}

export type ProjectionKind = "fold" | "map" | "state";

export type BatchPhase = "mark" | "pause" | "drain" | "cutoff" | "replay" | "write" | "unmark";

export interface ReplayProgress {
  phase: "replaying";

  // Projection context
  currentProjectionName: string;
  currentProjectionKind: ProjectionKind;
  currentProjectionIndex: number;
  totalProjections: number;

  // Aggregate totals (for current projection)
  totalAggregates: number;
  tenantCount: number;

  // Current batch
  currentBatch: number;
  totalBatches: number;
  batchAggregates: number;
  batchPhase: BatchPhase;
  batchEventsProcessed: number;

  // Overall progress
  aggregatesCompleted: number;
  totalEventsReplayed: number;
  elapsedSec: number;
  skippedCount: number;
  batchErrors: number;
  firstError?: string;
}

export interface BatchCompleteInfo {
  projectionName: string;
  projectionKind: ProjectionKind;
  batchNum: number;
  totalBatches: number;
  aggregatesInBatch: number;
  eventsInBatch: number;
  durationSec: number;
}

export interface ReplayConfig {
  projections: RegisteredFoldProjection[];
  mapProjections?: RegisteredMapProjection[];
  /**
   * Operational state projections to rebuild into their stores. Only
   * `ReplayService.replay` routes these; the fold/map engine rejects a config
   * carrying them rather than silently skipping them.
   */
  stateProjections?: RegisteredStateProjection[];
  tenantIds: string[];
  since: string;
  aggregateIds?: string[];
  batchSize?: number;
  aggregateBatchSize?: number;
  concurrency?: number;
  dryRun?: boolean;
}

export interface ReplayCallbacks {
  onProgress?: (progress: ReplayProgress) => void;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
}

export interface ReplayResult {
  aggregatesReplayed: number;
  totalEvents: number;
  batchErrors: number;
  firstError?: string;
}

export interface DiscoveryResult {
  aggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
  tenantCount: number;
  totalEvents: number;
}

/**
 * Shared dependencies the replay implementations (the fold/map engine and the
 * state lane) receive from `ReplayService`.
 */
export interface ReplayContext {
  redis: ReplayRedis;
  eventSource: ReplayEventSource;
  /** Accumulator options carrying the retention resolver (if wired). */
  accumulatorOpts: { retentionResolver?: RetentionPolicyResolver };
}

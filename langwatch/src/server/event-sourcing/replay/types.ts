import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import type { Event } from "../domain/types";

export interface RegisteredFoldProjection {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  definition: FoldProjectionDefinition<any, Event>;
  /**
   * Pause-set entry consumed by the GroupQueue Lua dispatcher. Folds are
   * enqueued as `__jobType=projection`, so this is `{pipeline}/projection/{name}`.
   */
  pauseKey: string;
  kind: "fold";
  /** ClickHouse table name for OPTIMIZE after replay. Omit for non-CH stores. */
  targetTable?: string;
}

export interface RegisteredMapProjection {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  definition: MapProjectionDefinition<any, Event>;
  /**
   * Pause-set entry consumed by the GroupQueue Lua dispatcher. Maps are
   * enqueued as `__jobType=handler`, so this is `{pipeline}/handler/{name}`.
   */
  pauseKey: string;
  kind: "map";
  /** ClickHouse table name for OPTIMIZE after replay. Omit for non-CH stores. */
  targetTable?: string;
}

export type ProjectionKind = "fold" | "map";

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
  aggregates: import("./replayEventLoader").DiscoveredAggregate[];
  byTenant: Map<string, import("./replayEventLoader").DiscoveredAggregate[]>;
  tenantCount: number;
  totalEvents: number;
}

import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { Event } from "../domain/types";

export interface RegisteredFoldProjection {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  definition: FoldProjectionDefinition<any, Event>;
  pauseKey: string;
  /** ClickHouse table name for OPTIMIZE after replay. Omit for non-CH stores. */
  targetTable?: string;
}

export type BatchPhase = "mark" | "pause" | "drain" | "cutoff" | "replay" | "write" | "unmark";

export interface ReplayProgress {
  phase: "replaying";

  // Projection context
  currentProjectionName: string;
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
  batchNum: number;
  totalBatches: number;
  aggregatesInBatch: number;
  eventsInBatch: number;
  durationSec: number;
}

export interface ReplayConfig {
  projections: RegisteredFoldProjection[];
  tenantIds: string[];
  since: string;
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

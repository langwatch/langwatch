import type { ProcessCommandParams } from "~/server/event-sourcing/services/commands/commandDispatcher.js";
import type { Event } from "~/server/event-sourcing/domain/types.js";
import type { EventRecord } from "~/server/event-sourcing/stores/repositories/eventRepository.types.js";

export interface Cursor {
  lastEventTimestamp: number;
  lastEventId?: string;
  sortValues?: unknown[];
}

export interface EsStats {
  totalEvents: number;
  minTimestamp: number;
  maxTimestamp: number;
}

export interface MigrationConfig {
  batchSize: number;
  dryRun: boolean;
  concurrency: number;
  delayBetweenBatchesMs: number;
  maxEvents?: number;
  maxBatches?: number;
  dryRunOutputFile?: string;
}

export interface MigrationStats {
  total: number;
  dispatched: number;
  skipped: number;
  duplicates: number;
  errors: number;
}

export interface EsHit {
  _id: string;
  [key: string]: unknown;
}

export interface EsBatch {
  events: EsHit[];
  sortValues: unknown[];
}

export interface CursorStore {
  load(): Promise<Cursor | null>;
  save(cursor: Cursor): Promise<void>;
}

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface CommandToProcess {
  payload: Record<string, unknown>;
  commandType: string;
  commandSchema: ProcessCommandParams<Event>["commandSchema"];
  handler: ProcessCommandParams<Event>["handler"];
  getAggregateId: ProcessCommandParams<Event>["getAggregateId"];
  commandName: string;
  /**
   * Deterministic idempotency key derived from ES source data.
   * Ensures re-processing the same ES document produces events with
   * identical keys, enabling dedup at both write and read time.
   */
  idempotencyKey: string;
}

export interface MigrationDefinition<TDocument = unknown> {
  name: string;
  esIndex: string;
  esQuery?: Record<string, unknown>;
  esSort: Array<Record<string, string>>;
  aggregateType: string;

  /** Group raw ES hits into aggregate documents, return complete ones. */
  aggregate(events: EsHit[]): Map<string, TDocument>;

  /** Flush remaining buffered aggregates at end of scan. */
  flush?(): Map<string, TDocument>;

  /** Build processCommand params from an aggregated document. */
  buildCommands(doc: TDocument): CommandToProcess[];

  /**
   * Group events by tenant → aggregate IDs for scoped existence checks.
   * Ensures clear tenant ownership — no cross-tenant overlap.
   */
  getTenantAggregates(events: EsHit[]): Map<string, Set<string>>;

  /** Optional: timestamp field name for range filter (default: first sort field). */
  timestampField?: string;

  /** Optional: stats aggregation field (default: timestampField). */
  statsField?: string;

  /**
   * Compute the fold projection state from events (for dry-run output).
   * Uses the pipeline's fold init() + apply() with no store writes.
   */
  computeProjection?: (events: Event[]) => unknown;

  /**
   * Direct-write: process an aggregate entirely in memory, returning bulk-insert data.
   * When present, the migrator uses this instead of buildCommands + processCommand.
   */
  processAggregate?(doc: TDocument, aggregateId: string): DirectWriteResult;
}

export interface DirectWriteResult {
  /** Event records to bulk-insert into event_log. */
  eventRecords: EventRecord[];
  /** Deferred projection store calls (fold/map). */
  projectionWrites: Array<() => Promise<void>>;
  /** Number of logical commands for stats. */
  commandCount: number;
  /** Computed projection state for dry-run output. */
  projectionState?: unknown;
}

/**
 * Simplified definition for discovery-based migrations.
 * Instead of streaming events and buffering aggregates, the discovery migrator:
 * 1. Scans ES in time windows to discover aggregate IDs
 * 2. Fetches ALL events for each aggregate in a single query
 * 3. Calls processAggregate with the complete event set
 *
 * No buffering, no flush, no cross-batch state.
 */
export interface DiscoveryMigrationDefinition {
  name: string;
  esIndex: string;
  esQuery?: Record<string, unknown>;
  esSort: Array<Record<string, string>>;
  aggregateType: string;
  /** Field used to group events into aggregates (e.g. "scenario_run_id"). */
  aggregateIdField: string;
  /** ES field that holds the tenant/project ID (e.g. "project_id"). */
  tenantIdField: string;
  /** Timestamp field for range queries (default: first sort field). */
  timestampField?: string;
  /** Stats aggregation field (default: timestampField). */
  statsField?: string;
  /** Process a complete aggregate (all events pre-fetched). */
  processAggregate(events: EsHit[], aggregateId: string): DirectWriteResult;
}

export interface ClickHouseHealth {
  query(opts: {
    query: string;
    format: "JSONEachRow";
  }): Promise<{ json<T>(): Promise<T[]> }>;
}

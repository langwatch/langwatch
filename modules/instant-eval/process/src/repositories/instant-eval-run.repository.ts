/**
 * The run's own row: the service writes the definition, the projection lays
 * its counters over what it reads, so a deleted run is never resurrected.
 * @see packages/clickhouse-migrations/migrations/00098_create_instant_eval_runs.sql
 */

import type { Instant } from "@langwatch/time";

import type { InstantEvalStoredStatus } from "../rules/instant-eval-run-status.rules.ts";

/** One run as the application reads it: the definition and the counters. */
export interface InstantEvalRunRow {
  readonly id: string;
  readonly projectId: string;
  readonly name: string | null;
  /** The statement, exactly as submitted. */
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly questions: readonly unknown[];
  /** The query validator's hydration plan, read back once per page. */
  readonly plan: readonly unknown[];
  readonly rowLimit: number;
  readonly status: InstantEvalStoredStatus;
  readonly total: number | null;
  readonly progress: number;
  readonly matched: number | null;
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  readonly failed: number;
  readonly skipped: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly priceUsd: number;
  readonly error: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly startedAt: Instant | null;
  readonly finishedAt: Instant | null;
  /** The projection's checkpoint, null until the first event is folded. */
  readonly occurredAt: number | null;
  readonly acceptedAt: number | null;
  readonly lastEventId: string | null;
  readonly projectionVersion: string | null;
}

/** The definition a run is created with. Never written again. */
export interface InstantEvalRunDefinition {
  readonly id: string;
  readonly projectId: string;
  readonly name: string | null;
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly questions: readonly unknown[];
  readonly plan: readonly unknown[];
  readonly rowLimit: number;
}

export interface InstantEvalRunListQuery {
  readonly projectId: string;
  readonly limit: number;
  /** Runs created strictly before this instant, the first half of the cursor. */
  readonly before?: Instant;
  /**
   * The id the previous page ended on, the second half: two runs can share a
   * `createdAt`, so the instant alone is not a total order.
   */
  readonly beforeId?: string;
}

export interface InstantEvalRunRepository {
  create(definition: InstantEvalRunDefinition): Promise<InstantEvalRunRow>;
  /** `null` when no run of this project has that id. */
  findById(input: { projectId: string; runId: string }): Promise<InstantEvalRunRow | null>;
  findPage(query: InstantEvalRunListQuery): Promise<InstantEvalRunRow[]>;
  /** One whole row, versioned by the writer's clock. */
  write(row: InstantEvalRunRow): Promise<void>;
  /**
   * Fails a run whose start was never dispatched: the only status change with
   * no event to fold, because the command that would have produced it is what
   * failed. Scoped to a run still queued, so it cannot overtake one that ran.
   */
  fail(input: { projectId: string; runId: string; code: string }): Promise<void>;
}

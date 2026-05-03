// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PullerAdapter — universal contract for pull-mode IngestionSources.
 *
 * Inspired by Singer Tap, Airbyte CDK, Apache Camel, and Kafka Connect.
 * Every adapter implements the same lifecycle so the BullMQ worker that
 * drives them is source-agnostic — it doesn't care whether the events
 * came from an HTTP audit-log API, an S3 NDJSON drop, or a Microsoft
 * Graph endpoint.
 *
 * Lifecycle:
 *   1. Admin creates an IngestionSource with `pullConfig` (the JSON
 *      shape this adapter understands)
 *   2. `validateConfig(config)` runs at create time — bad config is
 *      rejected BEFORE the row lands in PG, so the admin sees the
 *      error inline rather than silently failing later
 *   3. BullMQ schedules `runOnce({ cursor })` per the configured cron
 *   4. Adapter pulls events, maps them to NormalizedEvent, returns
 *      `{ events, cursor, errorCount }`
 *   5. Worker persists `cursor` → `IngestionSource.pollerCursor` so the
 *      next run resumes from the last known position
 *
 * Cursor semantics:
 *   - `null` cursor = drained (no more events to fetch this cycle)
 *   - non-null cursor = "more events available; pass me back next call"
 *   - cursor advancement is the SOLE source of forward progress —
 *     adapters MUST NOT track in-memory state across runs
 *   - on error, cursor is NOT advanced; next run retries from the same
 *     cursor (worst case: small re-pull window if the source is
 *     at-least-once)
 *
 * Error handling:
 *   - Adapter throws → worker logs + captureException + increments
 *     `IngestionSource.errorCount` + leaves cursor untouched
 *   - Worker remains alive for other puller jobs (one bad source
 *     doesn't poison the entire fleet)
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { z } from "zod";

/**
 * Canonical event shape produced by every adapter. Downstream code
 * (worker handoff to trace-store) doesn't care which adapter produced
 * the event — it only cares about this canonical shape. New fields
 * MUST be added here (or under `extra`) rather than in adapter-specific
 * shapes.
 */
export const normalizedPullEventSchema = z.object({
  /** Adapter-specific stable id. Used for at-most-once dedup. */
  source_event_id: z.string(),
  /** ISO 8601 timestamp of when the event happened (NOT when we pulled it). */
  event_timestamp: z.string(),
  /** User-identifying string (typically email). Empty string if unknown. */
  actor: z.string(),
  /** Verb describing what happened (e.g. "completion", "tool_call"). */
  action: z.string(),
  /** Target of the action (e.g. model name, tool name, document id). */
  target: z.string(),
  /** USD cost (0 if the source doesn't expose it). */
  cost_usd: z.number().nonnegative().default(0),
  /** Input tokens (0 if unknown). */
  tokens_input: z.number().nonnegative().int().default(0),
  /** Output tokens (0 if unknown). */
  tokens_output: z.number().nonnegative().int().default(0),
  /**
   * Full original event payload as a JSON-serialised string. Preserved
   * verbatim so a future schema change at the source can be re-played
   * against new event mappings without re-pulling.
   */
  raw_payload: z.string(),
  /**
   * Adapter-specific extra metadata. Reserved for adapter authors to
   * stash source-specific signals (correlation ids, request ids, etc.)
   * without polluting the canonical fields.
   */
  extra: z.record(z.unknown()).optional(),
});

export type NormalizedPullEvent = z.infer<typeof normalizedPullEventSchema>;

/**
 * Result of a single `runOnce` invocation. Drained when `cursor === null`.
 */
export interface PullResult {
  events: NormalizedPullEvent[];
  cursor: string | null;
  errorCount: number;
}

/**
 * Per-run input. The worker passes the LAST PERSISTED cursor (or null
 * for first-ever run). Adapters MUST be restart-safe — a worker crash
 * + restart with the same cursor must not skip events.
 */
export interface PullRunOptions {
  cursor: string | null;
  /**
   * Adapter-specific credential payload, resolved server-side from
   * IngestionSource credentials by the worker BEFORE calling the
   * adapter. Adapters never see raw credentials at rest — only the
   * resolved values they need for outbound calls.
   */
  credentials?: Record<string, string>;
  /**
   * Context the adapter may want for header substitution (org id,
   * source id, etc.) — never sensitive.
   */
  context?: {
    organizationId: string;
    ingestionSourceId: string;
  };
  /**
   * Optional overall deadline (ms since epoch). Adapters that paginate
   * SHOULD short-circuit when Date.now() > deadlineMs and return the
   * cursor at the last successful page so the next run resumes
   * promptly. Set by the worker per per-run job timeout. Soft hint;
   * adapters that miss the deadline by a small amount are fine.
   */
  deadlineMs?: number;
}

/**
 * Universal adapter contract. New source-types implement this (often
 * by extending `HttpPollingPullerAdapter` or `S3PollingPullerAdapter`
 * and locking the config shape).
 *
 * Adapters are LONG-LIVED in worker memory — a single adapter instance
 * handles many `runOnce` invocations across different IngestionSources.
 * They MUST NOT store per-source state in instance fields.
 */
export interface PullerAdapter<Config = unknown> {
  /**
   * Stable adapter id (e.g. "http_polling", "s3_polling",
   * "copilot_studio"). Persisted in pullConfig as `adapter`. The
   * registry maps id → adapter instance.
   */
  readonly id: string;

  /**
   * Validate a pullConfig payload at IngestionSource create/update
   * time. Throw a `ZodError` (or anything with `.message`) on failure.
   * The thrown error message surfaces in the admin UI inline.
   */
  validateConfig(config: unknown): Config;

  /**
   * Pull events. Implementations MUST:
   *   - read cursor from `options.cursor` (start fresh on null)
   *   - return `cursor: null` when drained
   *   - return `cursor: <value>` when more events are available
   *     (the worker may chain calls within a single job, or wait
   *     for the next scheduled run depending on adapter contract)
   *   - never advance the cursor on partial-failure (caller relies
   *     on at-least-once semantics from the cursor)
   */
  runOnce(
    options: PullRunOptions,
    config: Config,
  ): Promise<PullResult>;
}

/**
 * Registry mapping adapter id → adapter instance. The worker resolves
 * an IngestionSource's `pullConfig.adapter` field through this registry
 * and dispatches to the matching `runOnce`.
 */
export class PullerAdapterRegistry {
  private readonly adapters = new Map<string, PullerAdapter<unknown>>();

  register<C>(adapter: PullerAdapter<C>): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(
        `PullerAdapter "${adapter.id}" is already registered`,
      );
    }
    this.adapters.set(adapter.id, adapter as PullerAdapter<unknown>);
  }

  get(adapterId: string): PullerAdapter<unknown> | undefined {
    return this.adapters.get(adapterId);
  }

  /** All registered adapter ids. Useful for admin UI source-type discovery. */
  ids(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Test-only: clear all registrations. */
  clear(): void {
    this.adapters.clear();
  }
}

/**
 * Singleton registry. Adapter modules register themselves at import
 * time so the worker doesn't need to know about every adapter — it
 * just looks them up by `pullConfig.adapter`.
 */
export const pullerAdapterRegistry = new PullerAdapterRegistry();

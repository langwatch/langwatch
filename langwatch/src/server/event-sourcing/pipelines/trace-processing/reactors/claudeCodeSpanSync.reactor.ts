import {
  type ClaudeCodeLogRecordInput,
  CLAUDE_CODE_EVENT_SCOPE,
  CLAUDE_CODE_PII_ATTR,
  CLAUDE_TURN_LOG_CAP,
  MAX_CONVERSION_BATCHES_PER_JOB,
  convertClaudeCodeTurnToSpansIncremental,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import {
  type ClaudeTurnConversionState,
  emptyClaudeTurnConversionState,
} from "~/server/app-layer/traces/claude-code-turn-conversion.state";
import type { StoredLogRecordRow } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type {
  OtlpKeyValue,
  OtlpResource,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import { createLogger } from "~/utils/logger/server";
import type { CommandDispatcher } from "../../../deferred";
import type { ReactorDefinition } from "../../../reactors/reactor.types";
import {
  piiRedactionLevelSchema,
  type RecordSpanCommandData,
} from "../schemas/commands";
import { isLogRecordReceivedEvent, type TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:claude-code-span-sync-reactor",
);

/**
 * Reads / writes the per-turn incremental conversion state (keyed by tenantId +
 * traceId). Injected so the reactor stays testable with an in-memory store; the
 * composition root binds a Redis-backed implementation. `read` returns the
 * parsed state or null (missing / corrupt → the reactor starts from zero, a safe
 * idempotent full redraw). `write` persists with a refreshed TTL.
 */
export interface ClaudeTurnConversionStateStore {
  read: (
    tenantId: string,
    traceId: string,
  ) => Promise<ClaudeTurnConversionState | null>;
  write: (
    tenantId: string,
    traceId: string,
    state: ClaudeTurnConversionState,
  ) => Promise<void>;
}

export interface ClaudeCodeSpanSyncReactorDeps {
  /**
   * Fetch one bounded batch of a turn's marked logs strictly after `afterKey`
   * (in turn order), `limit` records at most. The reactor pages the turn one
   * batch at a time so each pass reads only records it has not converted yet.
   */
  getMarkedClaudeCodeLogs: (
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
    afterKey?: { timeUnixMs: number; sequence: number },
  ) => Promise<StoredLogRecordRow[]>;
  /**
   * Count the turn's marked logs uncapped, so a turn the reactor is still behind
   * on stamps the TRUE remaining-log count (total minus what it has converted)
   * rather than a lower bound. Called only when a job exits still behind; on
   * failure the reactor falls back to the batch-size lower bound and the
   * truncation marker still stamps.
   */
  countMarkedClaudeCodeLogs: (
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ) => Promise<number>;
  recordSpan: CommandDispatcher<RecordSpanCommandData>;
  /** Persisted incremental conversion state store (Redis in production). */
  stateStore: ClaudeTurnConversionStateStore;
  /**
   * Records converted per batch. The reactor pages the turn in batches of this
   * size; defaults to {@link CLAUDE_TURN_LOG_CAP}, operator override resolved
   * from `LANGWATCH_CLAUDE_TURN_LOG_CAP` in the composition root.
   */
  turnLogCap?: number;
  /**
   * Max batches one job converts before yielding; defaults to
   * {@link MAX_CONVERSION_BATCHES_PER_JOB}, operator override resolved from
   * `LANGWATCH_CLAUDE_TURN_MAX_BATCHES` in the composition root.
   */
  maxBatches?: number;
}

/**
 * Folds a Claude Code turn's saved logs into spans, INCREMENTALLY.
 *
 * Claude Code logs its model calls and tool calls as OTLP log records split
 * across export batches (request body at call START, anchor + response at call
 * END), so a per-batch converter can never rejoin them. The receiver instead
 * SAVES those logs to stored_log_records (marked), and this reactor, fired
 * after the trace fold on each claude log, pages the turn's saved logs in
 * bounded batches and folds each batch against the carried conversion state,
 * dispatching the resulting spans. Because trace == turn (`traceId =
 * sha256(session:prompt)`), the set is one turn's worth of records.
 *
 * A turn is NOT assumed small: one pathological agentic turn can stream
 * thousands of tool/model calls. Rather than truncate the turn, the reactor
 * CONVERGES it: each pass fetches `turnLogCap` records strictly after the last
 * converted cursor, converts them incrementally, dispatches the spans, and
 * persists the advanced state; it loops while a full batch came back, up to
 * `maxBatches` per job. One job converts up to `cap × maxBatches` records
 * (50,000 at defaults); a turn larger than that finishes on the next event's
 * debounced job, because every record still fires a job and the last record's
 * job converges the turn. If a job exits with a full final batch (more records
 * likely remain), the root span is stamped
 * langwatch.claude_code.truncated_logs = true + dropped_log_count, meaning
 * "conversion behind, will continue", which is CLEARED (attribute omitted) on
 * the catch-up re-emission once a later pass drains the turn.
 *
 * Idempotent: the converter emits stable SpanIds + a completeness-nudged
 * StartTime, so re-firing (and re-converting from zero when state is lost)
 * converges on the same spans (the stored_spans ReplacingMergeTree dedups them).
 * The reactor gates on claude LOG events only, so the spans it produces never
 * re-trigger it (no loop). A short debounce coalesces a batch's logs into one
 * conversion job.
 */
export function createClaudeCodeSpanSyncReactor(
  deps: ClaudeCodeSpanSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent> {
  return {
    name: "claudeCodeSpanSync",
    options: {
      runIn: ["worker"],
      // Coalesce a batch's claude logs into one conversion job; correctness does
      // not depend on the exact debounce (a later, more complete pass wins the
      // completeness nudge, and every record fires a job so the turn converges),
      // it just bounds how often the turn is paged.
      makeJobId: (payload) =>
        `claude-span-sync:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 2_000,
      delay: 1_500,
    },

    async handle(event: TraceProcessingEvent): Promise<void> {
      // Only claude_code LOG ingestion drives the fold. Spans the reactor
      // emits arrive as span events, which are ignored here — no feedback loop.
      if (!isLogRecordReceivedEvent(event)) return;
      if (event.data.scopeName !== CLAUDE_CODE_EVENT_SCOPE) return;

      const tenantId = event.tenantId;
      const traceId = String(event.aggregateId);
      const turnLogCap = deps.turnLogCap ?? CLAUDE_TURN_LOG_CAP;
      const maxBatches = deps.maxBatches ?? MAX_CONVERSION_BATCHES_PER_JOB;

      try {
        // Load the carried state, or start from zero on missing / corrupt state:
        // the cursor at zero refetches from the turn's start, and the spans
        // upsert over themselves by their deterministic ids, so a lost state
        // re-converts the whole turn idempotently (the correctness backstop).
        const loaded = await deps.stateStore.read(tenantId, traceId);
        let state = loaded ?? emptyClaudeTurnConversionState();

        let batchesRun = 0;
        let lastBatchFull = false;
        let convertedAny = false;
        // The last PII level a batch stamped, reused for the once-per-job root
        // re-emission after the loop (STRICT if no batch stamped one).
        let lastPiiLevel: RecordSpanCommandData["piiRedactionLevel"] = "STRICT";

        while (batchesRun < maxBatches) {
          // The triggering log event's occurredAt bounds the stored_log_records
          // scan to the turn's partitions instead of cold-scanning S3.
          const afterKey =
            state.cursor.timeUnixMs > 0 || state.cursor.sequence > 0
              ? state.cursor
              : undefined;
          const batch = await deps.getMarkedClaudeCodeLogs(
            tenantId,
            traceId,
            event.occurredAt,
            turnLogCap,
            afterKey,
          );
          batchesRun += 1;
          if (batch.length === 0) {
            lastBatchFull = false;
            break;
          }
          lastBatchFull = batch.length >= turnLogCap;

          const records = batch.map(rowToRecord);
          lastPiiLevel = resolvePiiLevel(batch);

          // Convert this batch against the carried state. Dispatch only the CHILD
          // spans per batch; the root is re-emitted ONCE after the loop with the
          // correct truncation flag, so its single per-job emission carries the
          // final envelope + marker and wins the stored_spans dedup (a later job
          // that drains more converges to a strictly greater root progress).
          const { spans, nextState } = convertClaudeCodeTurnToSpansIncremental({
            traceId,
            records,
            state,
            truncation: { droppedLogCount: 0 },
          });

          for (const synthesized of spans) {
            if (synthesized.span.parentSpanId === null) continue; // root: after loop
            await deps.recordSpan({
              tenantId,
              span: synthesized.span,
              resource: synthesized.resource,
              instrumentationScope: synthesized.instrumentationScope,
              piiRedactionLevel: lastPiiLevel,
              occurredAt: event.occurredAt,
            });
          }

          state = nextState;
          convertedAny = convertedAny || spans.length > 0;
          await deps.stateStore.write(tenantId, traceId, state);

          if (!lastBatchFull) break;
        }

        // The job exits still behind only when the final batch came back full
        // (more records likely remain) AND the batch ceiling stopped the loop.
        // Emit the root ONCE with the truncation marker set iff still behind; the
        // next event's debounced job resumes from the cursor, drains the turn,
        // and re-emits the root without the marker (the UI-visible value flips).
        const behind = lastBatchFull && batchesRun >= maxBatches;
        if (convertedAny) {
          await emitRoot({
            deps,
            tenantId,
            traceId,
            occurredAtMs: event.occurredAt,
            state,
            turnLogCap,
            behind,
            piiRedactionLevel: lastPiiLevel,
          });
        }

        logger.debug(
          {
            tenantId,
            traceId,
            batchesRun,
            behind,
            cursor: state.cursor,
          },
          "Synced Claude Code logs into spans (incremental)",
        );
      } catch (error) {
        logger.error(
          {
            tenantId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to sync Claude Code logs into spans",
        );
      }
    },
  };
}

/**
 * Emit the turn's root span ONCE per job from the final converted state. When
 * the job exits still `behind`, the root carries the truncation marker with the
 * TRUE remaining-log count (uncapped total minus what has been converted); a
 * count-query failure falls back to one batch's worth as a lower bound so the
 * marker still stamps. When NOT behind (the turn drained), no marker is set, so
 * a job that catches up flips the UI-visible value off. Re-emitting from the
 * carried state (records: []) rebuilds the root's input / session / envelope
 * from the accumulators; no new child spans are produced (empty batch).
 */
async function emitRoot({
  deps,
  tenantId,
  traceId,
  occurredAtMs,
  state,
  turnLogCap,
  behind,
  piiRedactionLevel,
}: {
  deps: ClaudeCodeSpanSyncReactorDeps;
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
  state: ClaudeTurnConversionState;
  turnLogCap: number;
  behind: boolean;
  piiRedactionLevel: RecordSpanCommandData["piiRedactionLevel"];
}): Promise<void> {
  let droppedLogCount = 0;
  if (behind) {
    droppedLogCount = turnLogCap; // lower bound: at least one more batch remains
    try {
      const total = await deps.countMarkedClaudeCodeLogs(
        tenantId,
        traceId,
        occurredAtMs,
      );
      const remaining = total - convertedRecordEstimate(state, turnLogCap);
      if (remaining > 0) droppedLogCount = remaining;
    } catch (countError) {
      logger.debug(
        {
          tenantId,
          traceId,
          turnLogCap,
          lowerBound: droppedLogCount,
          error:
            countError instanceof Error
              ? countError.message
              : String(countError),
        },
        "Failed to count Claude Code turn's marked logs; stamping the lower-bound remaining count",
      );
    }
  }

  const { spans } = convertClaudeCodeTurnToSpansIncremental({
    traceId,
    records: [],
    state,
    truncation: { droppedLogCount },
  });
  const root = spans.find((s) => s.span.parentSpanId === null);
  if (root) {
    await deps.recordSpan({
      tenantId,
      span: root.span,
      resource: root.resource,
      instrumentationScope: root.instrumentationScope,
      piiRedactionLevel,
      occurredAt: occurredAtMs,
    });
  }

  if (behind) {
    logger.warn(
      {
        tenantId,
        traceId,
        turnLogCap,
        droppedLogCount,
        cursor: state.cursor,
      },
      "Claude Code turn conversion is behind after the per-job batch ceiling; marked truncated, will continue on the next event's debounce",
    );
  }
}

/**
 * Estimate how many marked records have been converted so far from the carried
 * state, used to derive the TRUE remaining count. The exact converted count is
 * not tracked as a single field (the state stays compact), but the root
 * accumulators (`modelCallCount` × 3 convertible model records + `toolCallCount`
 * × ~2 tool records, plus the user prompt) approximate it closely; when the
 * approximation would understate, the count query's total still bounds it. The
 * remaining is floored at one batch below, so the marker never under-reports to
 * zero while the loop is genuinely behind.
 */
function convertedRecordEstimate(
  state: ClaudeTurnConversionState,
  turnLogCap: number,
): number {
  const modelRecords = state.root.modelCallCount * 3;
  const toolRecords = state.root.toolCallCount * 2;
  const promptRecords = state.root.input ? 1 : 0;
  const estimate = modelRecords + toolRecords + promptRecords;
  // At least one batch has been converted when the loop is behind, so floor the
  // estimate so `total - estimate` cannot exceed the total.
  return Math.max(estimate, turnLogCap);
}

function rowToRecord(row: StoredLogRecordRow): ClaudeCodeLogRecordInput {
  const resource: OtlpResource = {
    attributes: mapToKeyValues(row.resourceAttributes),
  };
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    timeUnixMs: row.timeUnixMs,
    eventName: row.attributes["event.name"] ?? "",
    attrs: row.attributes,
    resource,
    instrumentationScope: { name: row.scopeName, version: row.scopeVersion },
  };
}

function mapToKeyValues(map: Record<string, string>): OtlpKeyValue[] {
  return Object.entries(map).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
}

/**
 * The PII level the receiver stamped on the logs (it redacts the derived spans
 * exactly as the trapped-span path used to). Defaults to STRICT so an
 * unexpectedly-unmarked log is never under-redacted.
 */
function resolvePiiLevel(
  rows: StoredLogRecordRow[],
): RecordSpanCommandData["piiRedactionLevel"] {
  for (const row of rows) {
    const parsed = piiRedactionLevelSchema.safeParse(
      row.attributes[CLAUDE_CODE_PII_ATTR],
    );
    if (parsed.success) return parsed.data;
  }
  return "STRICT";
}

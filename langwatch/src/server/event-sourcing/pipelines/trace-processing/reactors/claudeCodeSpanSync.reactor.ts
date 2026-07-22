import { createLogger } from "@langwatch/observability";
import {
  CLAUDE_CODE_EVENT_SCOPE,
  CLAUDE_CODE_PII_ATTR,
  CLAUDE_LOG_VISIBILITY_DEADLINE_MS,
  CLAUDE_TURN_LOG_CAP,
  type ClaudeCodeLogRecordInput,
  convertClaudeCodeTurnToSpans,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import type { StoredLogRecordRow } from "~/server/event-sourcing/ports/log-record-storage.repository";
import type {
  OtlpKeyValue,
  OtlpResource,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { CommandDispatcher } from "../../../deferred";
import type { ReactorDefinition } from "../../../reactors/reactor.types";
import {
  piiRedactionLevelSchema,
  type RecordSpanCommandData,
} from "../schemas/commands";
import {
  isLogContributedEvent,
  isLogRecordReceivedEvent,
  type TraceProcessingEvent,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:claude-code-span-sync-reactor",
);

class CanonicalLogNotVisibleError extends Error {}

export interface ClaudeCodeSpanSyncReactorDeps {
  getMarkedClaudeCodeLogs: (
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ) => Promise<StoredLogRecordRow[]>;
  /**
   * Count the turn's marked logs uncapped, so an overflowing turn stamps the TRUE
   * dropped-log count instead of the `cap + 1` lower bound the fetch can observe.
   * Called only in the over-cap branch; on failure the reactor falls back to the
   * lower bound and the truncation marker is still stamped.
   */
  countMarkedClaudeCodeLogs: (
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ) => Promise<number>;
  recordSpan: CommandDispatcher<RecordSpanCommandData>;
  /**
   * Maximum number of a turn's marked log records to convert in one pass. The
   * reactor fetches `cap + 1` so it can both convert the first `cap` records and
   * detect an overflowing turn, marking the root span truncated. Defaults to
   * {@link CLAUDE_TURN_LOG_CAP}; the composition root resolves the operator
   * override from `LANGWATCH_CLAUDE_TURN_LOG_CAP`.
   */
  turnLogCap?: number;
  /**
   * How long (ms) to keep retrying a contribution whose canonical logs are not
   * visible yet before giving up on it. Defaults to
   * {@link CLAUDE_LOG_VISIBILITY_DEADLINE_MS}; the composition root resolves the
   * operator override from `LANGWATCH_CLAUDE_LOG_VISIBILITY_DEADLINE_MS`.
   */
  visibilityDeadlineMs?: number;
  /**
   * Clock backing the visibility deadline. Injectable so tests can drive the
   * deadline deterministically; defaults to `Date.now`.
   */
  now?: () => number;
}

/**
 * Folds a Claude Code turn's saved logs into spans.
 *
 * Claude Code logs its model calls and tool calls as OTLP log records split
 * across export batches (request body at call START, anchor + response at call
 * END), so a per-batch converter can never rejoin them. The receiver stores
 * those logs canonically (with a rolling legacy-read fallback), and this
 * reactor — fired after the trace fold on each Claude contribution — re-reads
 * the turn's saved logs and runs the converter over the set, dispatching the
 * resulting spans. Because
 * trace == turn (`traceId = sha256(session:prompt)`), the set is one turn's
 * worth of records.
 *
 * A turn is NOT assumed small: one pathological agentic turn can stream
 * thousands of tool/model calls, which on `main` FIFO'd ~2,000+ recordLog jobs
 * into one command group and made this reactor re-read and re-convert the whole
 * growing set on every debounce. The reactor fetches at most `turnLogCap + 1`
 * marked records (in turn order), converts the first `turnLogCap`, and stamps
 * the root span truncated (via the converter's `truncation` arg) when the turn
 * overflows, so a runaway turn can neither seize the worker nor build an
 * unbounded span tree. See CLAUDE_TURN_LOG_CAP.
 *
 * Idempotent: the converter emits stable SpanIds + a completeness-nudged
 * StartTime, so re-firing as more of the turn arrives converges on the same
 * spans (the stored_spans ReplacingMergeTree dedups them). The reactor gates on
 * claude LOG events only, so the spans it produces never re-trigger it (no
 * loop). A short debounce coalesces a batch's logs into one re-fold.
 */
export function createClaudeCodeSpanSyncReactor(
  deps: ClaudeCodeSpanSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent> {
  return {
    name: "claudeCodeSpanSync",
    options: {
      runIn: ["worker"],
      // Coalesce a batch's claude logs into one re-fold; correctness does not
      // depend on the exact debounce (the completeness nudge makes a later,
      // more complete re-fold win), it just bounds re-reads of the turn.
      makeJobId: (payload) =>
        `claude-span-sync:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 2_000,
      delay: 1_500,
    },

    async handle(event: TraceProcessingEvent): Promise<void> {
      // Only claude_code LOG ingestion drives the fold. Spans the reactor
      // emits arrive as span events, which are ignored here — no feedback loop.
      if (!isLogRecordReceivedEvent(event) && !isLogContributedEvent(event)) {
        return;
      }
      if (event.data.scopeName !== CLAUDE_CODE_EVENT_SCOPE) return;

      const tenantId = event.tenantId;
      const traceId = String(event.aggregateId);
      const turnLogCap = deps.turnLogCap ?? CLAUDE_TURN_LOG_CAP;
      const logOccurredAtMs = isLogContributedEvent(event)
        ? event.data.timeUnixMs
        : event.occurredAt;

      try {
        // The log's source timestamp bounds both the canonical and rolling
        // legacy scans to the turn's partitions. Fetch one
        // past the cap so an overflowing turn is detectable while still bounding
        // the read; a pathological turn never materializes all of its records.
        const fetched = await deps.getMarkedClaudeCodeLogs(
          tenantId,
          traceId,
          logOccurredAtMs,
          turnLogCap + 1,
        );
        if (fetched.length === 0) {
          // The canonical log and its compact trace contribution travel through
          // separate durable pipelines. A contribution can reach this reactor
          // before the log projection is visible in ClickHouse. Throwing lets
          // the reactor queue retry instead of permanently missing the turn.
          if (isLogContributedEvent(event)) {
            const deadlineMs =
              deps.visibilityDeadlineMs ?? CLAUDE_LOG_VISIBILITY_DEADLINE_MS;
            const nowMs = deps.now?.() ?? Date.now();
            // event.occurredAt is the log's ingest wall-clock (the receiver's
            // acceptedAt), so this is how long the contribution has been
            // unfoldable — stable across retries of the same event.
            const ageMs = nowMs - event.occurredAt;
            if (ageMs <= deadlineMs) {
              throw new CanonicalLogNotVisibleError(
                `Canonical Claude logs are not visible yet for trace ${traceId}`,
              );
            }
            // Past the deadline the records are never going to appear (dropped
            // upstream, or a partition-window miss). Stop retrying: returning
            // completes the job so the per-trace group DRAINS, instead of a
            // poison pill that re-burns the 25-attempt retry ladder on every
            // re-emitted contribution and starves the shared event-sourcing
            // queue (prod incident 2026-07-20).
            logger.warn(
              {
                tenantId,
                traceId,
                ageMs,
                deadlineMs,
              },
              "Canonical Claude logs never became visible within the deadline; giving up on span sync for this contribution",
            );
            return;
          }
          return;
        }

        // Bound the conversion: keep the first `turnLogCap` records (turn order).
        const overflowed = fetched.length > turnLogCap;
        const rows = overflowed ? fetched.slice(0, turnLogCap) : fetched;

        // Record how many were dropped so the root span is marked truncated. The
        // fetch is capped at `turnLogCap + 1`, so `fetched.length - turnLogCap` is
        // only ever a lower bound (>= 1); a turn with 50,000 marked logs would
        // stamp 1, badly underestimating during an incident. Query the uncapped
        // count to stamp the TRUE total. If that count call fails, fall back to
        // the lower bound - the truncation marker must still stamp either way.
        let droppedLogCount = 0;
        if (overflowed) {
          const lowerBound = Math.max(1, fetched.length - turnLogCap);
          droppedLogCount = lowerBound;
          try {
            const total = await deps.countMarkedClaudeCodeLogs(
              tenantId,
              traceId,
              logOccurredAtMs,
            );
            droppedLogCount = Math.max(1, total - turnLogCap);
          } catch (countError) {
            logger.debug(
              {
                tenantId,
                traceId,
                turnLogCap,
                lowerBound,
                error:
                  countError instanceof Error
                    ? countError.message
                    : String(countError),
              },
              "Failed to count Claude Code turn's marked logs; stamping the lower-bound dropped count",
            );
          }
          logger.warn(
            {
              tenantId,
              traceId,
              turnLogCap,
              convertedLogCount: rows.length,
              droppedLogCount,
            },
            "Claude Code turn exceeded the per-turn conversion cap; converting the capped set and marking the trace truncated",
          );
        }

        const records = rows.map(rowToRecord);
        const piiRedactionLevel = resolvePiiLevel(rows);
        // The user-typed prompt per prompt.id, so a model call whose request
        // body claude truncated inline (~60KB) still shows the turn's input
        // instead of nothing.
        const promptTextById = new Map<string, string>();
        for (const record of records) {
          if (record.eventName !== "user_prompt") continue;
          const promptId = record.attrs["prompt.id"];
          const promptText = record.attrs.prompt;
          if (promptId && promptText) promptTextById.set(promptId, promptText);
        }
        const spans = convertClaudeCodeTurnToSpans(records, promptTextById, {
          droppedLogCount,
        });

        for (const synthesized of spans) {
          await deps.recordSpan({
            tenantId,
            span: synthesized.span,
            resource: synthesized.resource,
            instrumentationScope: synthesized.instrumentationScope,
            piiRedactionLevel,
            occurredAt: event.occurredAt,
          });
        }

        logger.debug(
          {
            tenantId,
            traceId,
            logCount: rows.length,
            droppedLogCount,
            spanCount: spans.length,
          },
          "Synced Claude Code logs into spans",
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
        if (error instanceof CanonicalLogNotVisibleError) throw error;
      }
    },
  };
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

import {
  type ClaudeCodeLogRecordInput,
  CLAUDE_CODE_EVENT_SCOPE,
  CLAUDE_CODE_PII_ATTR,
  convertClaudeCodeTurnToSpans,
} from "~/server/app-layer/traces/claude-code-log-to-span";
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

export interface ClaudeCodeSpanSyncReactorDeps {
  getMarkedClaudeCodeLogs: (
    tenantId: string,
    traceId: string,
  ) => Promise<StoredLogRecordRow[]>;
  recordSpan: CommandDispatcher<RecordSpanCommandData>;
}

/**
 * Folds a Claude Code turn's saved logs into spans.
 *
 * Claude Code logs its model calls and tool calls as OTLP log records split
 * across export batches (request body at call START, anchor + response at call
 * END), so a per-batch converter can never rejoin them. The receiver instead
 * SAVES those logs to stored_log_records (marked), and this reactor — fired
 * after the trace fold on each claude log — re-reads the WHOLE turn's saved
 * logs and runs the converter over the complete set, dispatching the resulting
 * spans. Because trace == turn (`traceId = sha256(session:prompt)`), the set is
 * small and bounded.
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
      if (!isLogRecordReceivedEvent(event)) return;
      if (event.data.scopeName !== CLAUDE_CODE_EVENT_SCOPE) return;

      const tenantId = event.tenantId;
      const traceId = String(event.aggregateId);

      try {
        const rows = await deps.getMarkedClaudeCodeLogs(tenantId, traceId);
        if (rows.length === 0) return;

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
        const spans = convertClaudeCodeTurnToSpans(records, promptTextById);

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
          { tenantId, traceId, logCount: rows.length, spanCount: spans.length },
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

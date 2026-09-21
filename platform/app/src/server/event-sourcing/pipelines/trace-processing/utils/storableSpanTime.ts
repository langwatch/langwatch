import type { SpanReceivedEvent } from "../schemas/events";
import { TraceRequestUtils } from "./traceRequest.utils";

/**
 * One predicate for "this epoch-ms value can be written as a span time", used at
 * both edges: the ingestion door refuses it, and every trace-processing consumer
 * of a stored `span_received` event skips it.
 *
 * Nothing bounds the FUTURE edge of a producer's span time — `SPAN_MAX_PAST_MS`
 * bounds only the past one (see `projections/services/storage-anchor.ts`), and a
 * native OTLP client sends whatever it likes. A start time wrong by orders of
 * magnitude — a millisecond value multiplied into nanoseconds twice over, say —
 * therefore reaches `IdUtils.makeDeterministicKsuid`, where the KSUID's 48-bit
 * SECONDS field refuses it. The event is already stored and the throw is classed
 * retryable, so the group queue retries it forever and one span blocks a whole
 * project's span-storage lane.
 */

/**
 * The latest instant span storage can represent, epoch ms.
 *
 * `stored_spans.StartTime` and `.EndTime` are `DateTime64(3)`
 * (`clickhouse/migrations/00002_create_schema.sql`), whose documented range ends
 * at 2299-12-31 23:59:59.999 UTC at precision 3. The KSUID timestamp field —
 * the thing that actually threw — tops out at 2^48-1 SECONDS, some millions of
 * years later, so ClickHouse is the binding ceiling and the only one worth
 * naming: a value this side of it cannot break the id, and a value past it
 * cannot be stored whatever the id does.
 */
export const MAX_STORABLE_SPAN_TIME_MS = Date.parse("2299-12-31T23:59:59.999Z");

/**
 * True when `valueMs` is an epoch-ms instant span storage can hold: finite (so
 * `NaN` and `Infinity` are out), strictly positive, and no later than
 * {@link MAX_STORABLE_SPAN_TIME_MS}. A fractional millisecond is fine: the id
 * floors to whole seconds and the column keeps milliseconds, so refusing one
 * would drop a valid time for nothing.
 *
 * Positional, unlike the rest of this module: a type predicate has to name a
 * parameter, so it cannot be written against a destructured binding.
 */
export function isStorableSpanTimeMs(
  valueMs: number | null | undefined,
): valueMs is number {
  return (
    typeof valueMs === "number" &&
    Number.isFinite(valueMs) &&
    valueMs > 0 &&
    valueMs <= MAX_STORABLE_SPAN_TIME_MS
  );
}

/** The one unstorable field a skipped span is named by, and its value. */
interface UnstorableSpanTime {
  field: "startTimeUnixMs" | "endTimeUnixMs";
  valueMs: number | null;
}

/**
 * The first of the span's own times that cannot be stored, or `null` when both
 * can.
 *
 * Both are checked because both are written: the store hands ClickHouse
 * `new Date(startTimeUnixMs)` and `new Date(endTimeUnixMs)` for two
 * non-nullable `DateTime64(3)` columns
 * (`repositories/span-storage.clickhouse.repository.ts`), so an unstorable end
 * time is an insert that fails or a column that silently holds the wrong
 * instant, on the same retry-forever lane as the start time.
 *
 * A wire value the nanosecond decoder refuses is the same condition, not a
 * different one — there is no storable time in the event either way — so the
 * conversion is read inside the guard rather than left to throw later out of
 * normalization. The `try` covers only that conversion, so no other failure is
 * swallowed by it.
 */
function unstorableSpanTimeOf(
  event: SpanReceivedEvent,
): UnstorableSpanTime | null {
  let startTimeUnixMs: number;
  let endTimeUnixMs: number;
  try {
    startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
      TraceRequestUtils.normalizeOtlpUnixNano(
        event.data.span.startTimeUnixNano,
      ),
    );
    endTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
      TraceRequestUtils.normalizeOtlpUnixNano(event.data.span.endTimeUnixNano),
    );
  } catch {
    return { field: "startTimeUnixMs", valueMs: null };
  }

  if (!isStorableSpanTimeMs(startTimeUnixMs)) {
    return { field: "startTimeUnixMs", valueMs: startTimeUnixMs };
  }
  if (!isStorableSpanTimeMs(endTimeUnixMs)) {
    return { field: "endTimeUnixMs", valueMs: endTimeUnixMs };
  }
  return null;
}

/** The minimum a consumer's logger has to offer to report a skipped span. */
interface SkipLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

/**
 * The replay-edge gate every trace-processing consumer of `span_received` calls
 * BEFORE normalization: `false` means this span's times cannot be stored, and
 * the caller skips it — a map projection by returning `null`, a fold by
 * returning its state unchanged.
 *
 * Skipping rather than throwing is the whole point. The event is already in the
 * log, so the failure is permanent; a throw is classed retryable and re-stages
 * the same job until the group is blocked, which takes down every other span in
 * the project with it.
 *
 * Logs exactly once per refusal, here rather than at each call site, so the
 * fields a reader needs to find the producer are the same wherever the span was
 * refused.
 */
export function isStorableSpanReceived({
  event,
  logger,
  consumer,
}: {
  event: SpanReceivedEvent;
  logger: SkipLogger;
  consumer: string;
}): boolean {
  const unstorable = unstorableSpanTimeOf(event);
  if (!unstorable) return true;

  logger.warn(
    {
      consumer,
      tenantId: event.tenantId,
      traceId: event.metadata.traceId,
      spanId: event.metadata.spanId,
      field: unstorable.field,
      valueMs: unstorable.valueMs,
      maxStorableMs: MAX_STORABLE_SPAN_TIME_MS,
    },
    // Static, so every refusal groups under one signature; `field` says which
    // of the two times it was and `valueMs` what the producer sent.
    "Skipping span: its recorded time cannot be stored",
  );
  return false;
}

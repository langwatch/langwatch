import { Temporal } from "@langwatch/time";
import type { OtlpSpan, SpanReceivedEvent } from "@langwatch/trace-contract";

import { OtlpTraceRequestService } from "../services/otlp-trace-request.service.ts";

/**
 * The latest instant a span time may carry: the `DateTime64(3)` ceiling, and
 * well inside the KSUID's 48-bit seconds field the span record id is minted
 * over. @see specs/traces/span-start-time-must-be-storable.feature
 */
export const MAX_STORABLE_SPAN_TIME_MS = Temporal.Instant.from(
  "2299-12-31T23:59:59.999Z",
).epochMilliseconds;

/** An epoch-ms instant storage can hold: finite, positive, under the ceiling. */
export function isStorableSpanTimeMs(valueMs: number | null | undefined): valueMs is number {
  return (
    typeof valueMs === "number" &&
    Number.isFinite(valueMs) &&
    valueMs > 0 &&
    valueMs <= MAX_STORABLE_SPAN_TIME_MS
  );
}

export interface UnstorableSpanTime {
  field: "startTimeUnixMs" | "endTimeUnixMs";
  /** What the producer sent, or `null` when it could not even be decoded. */
  valueMs: number | null;
}

export interface StorableSpanTimes {
  startTimeUnixMs: number;
  endTimeUnixMs: number;
}

function decodeSpanTime({
  field,
  unixNano,
}: {
  field: UnstorableSpanTime["field"];
  unixNano: OtlpSpan["startTimeUnixNano"];
}): { valueMs: number } | { unstorable: UnstorableSpanTime } {
  let valueMs: number;
  try {
    valueMs = OtlpTraceRequestService.convertUnixNanoToUnixMs(
      OtlpTraceRequestService.normalizeOtlpUnixNano(unixNano),
    );
  } catch {
    return { unstorable: { field, valueMs: null } };
  }
  return isStorableSpanTimeMs(valueMs) ? { valueMs } : { unstorable: { field, valueMs } };
}

/** Both span times in epoch ms, or the first one storage cannot hold. */
export function storableSpanTimesOf({
  startTimeUnixNano,
  endTimeUnixNano,
}: Pick<OtlpSpan, "startTimeUnixNano" | "endTimeUnixNano">):
  | { times: StorableSpanTimes }
  | { unstorable: UnstorableSpanTime } {
  const start = decodeSpanTime({ field: "startTimeUnixMs", unixNano: startTimeUnixNano });
  if ("unstorable" in start) return start;
  const end = decodeSpanTime({ field: "endTimeUnixMs", unixNano: endTimeUnixNano });
  if ("unstorable" in end) return end;
  return { times: { startTimeUnixMs: start.valueMs, endTimeUnixMs: end.valueMs } };
}

export const UNSTORABLE_SPAN_SKIPPED = "Skipping span: its recorded time cannot be stored";

export type SpanStorability =
  | { storable: true }
  | { storable: false; skip: Record<string, unknown> };

/**
 * Whether a received span's times can be stored. A span that cannot is
 * skipped rather than thrown on: normalization would fail permanently and the
 * retry would block the whole lane. `skip` carries the fields to log it under.
 */
export function spanStorabilityOf({
  event,
  consumer,
}: {
  event: SpanReceivedEvent;
  consumer: string;
}): SpanStorability {
  const decoded = storableSpanTimesOf(event.data.span);
  if (!("unstorable" in decoded)) return { storable: true };
  return {
    storable: false,
    skip: {
      consumer,
      tenantId: event.tenantId,
      traceId: event.metadata.traceId,
      spanId: event.metadata.spanId,
      field: decoded.unstorable.field,
      valueMs: decoded.unstorable.valueMs,
      maxStorableMs: MAX_STORABLE_SPAN_TIME_MS,
    },
  };
}

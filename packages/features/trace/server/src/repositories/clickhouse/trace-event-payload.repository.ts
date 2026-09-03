import { Ksuid } from "@langwatch/ksuid";
import { z } from "zod";
import type { TraceClickHouseClient, TraceClickHousePort } from "../../ports/clickhouse.port";

/**
 * Half-width (ms) of the `EventOccurredAt` window applied to event_log blob
 * reads. The KSUID creation time and `EventOccurredAt` are stamped from the
 * same ingestion clock, so they land within queue lag of each other; ±2 days
 * comfortably covers that skew while still pruning to the one or two weekly
 * partitions the row can live in. Matches the ±2-day span partition hint used
 * on the trace-fetch path.
 */
const EVENT_LOG_OCCURRED_AT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Extracts the creation time (ms) embedded in a KSUID EventId, or null when the
 * id is not a parseable KSUID (so callers fall back to an unpruned read rather
 * than risk excluding the row).
 */
function parseKsuidCreatedAtMs(eventId: string): number | null {
  try {
    return Ksuid.parse(eventId).date.getTime();
  } catch {
    return null;
  }
}

/**
 * Thrown when the requested row is not found or the TenantId predicate returns
 * no rows (including cross-tenant attempts). ADR-022: TenantId in the WHERE
 * clause structurally blocks cross-tenant reads.
 */
export class TraceEventPayloadNotFoundError extends Error {
  constructor(
    readonly eventId: string,
    readonly field: string,
    readonly tenantId: string,
  ) {
    super(`event_log row not found for eventId=${eventId} field=${field} tenantId=${tenantId}`);
    this.name = "BlobNotFoundError";
  }
}

/**
 * Thrown when the requested `field` is not present in the EventPayload.
 * Indicates a corrupted event or a stale ref.
 */
export class TraceEventPayloadFieldNotFoundError extends Error {
  constructor(
    readonly key: string,
    readonly field: string,
  ) {
    super(`Field "${field}" not found in event payload at key ${key}`);
    this.name = "BlobFieldNotFoundError";
  }
}

/** ClickHouse query response row from the event_log SELECT. */
const eventLogRowSchema = z.object({ EventPayload: z.string() });

/**
 * Span attribute entry inside EventPayload.
 *
 * EventPayload stores RAW OTLP spans (`EventPayload` IS `event.data`), whose
 * attribute `value` is an OTLP `AnyValue` oneof —
 * `stringValue | intValue | boolValue | doubleValue | arrayValue | kvlistValue |
 * bytesValue`. The read path only ever needs the offloaded IO fields, which are
 * stored as `stringValue`, so this schema reads ONLY `stringValue` and leaves
 * it optional.
 *
 * Critically, `span.attributes` is parsed PER-ELEMENT and defensively: a single
 * non-string or malformed sibling attribute can never fail the whole-array
 * parse and mask the offloaded field. The old strict shape
 * `value: { stringValue: z.string() }` rejected EVERY real span that carried a
 * numeric/boolean attribute (e.g. `gen_ai.usage.input_tokens` =
 * `{ intValue: "100" }`), which failed `z.array(...)`, failed the payload
 * parse, and degraded every > 64 KB read to the 64 KB preview (#4888).
 */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});

/**
 * Parsed EventPayload structure (ADR-022: full event as stored by the command
 * worker).
 *
 * EventPayload IS event.data (stored as `event.data ?? {}` by eventToRecord).
 * The span write shape from recordSpanCommand is
 * `{ span, resource, instrumentationScope }` with the span at the TOP level —
 * there is NO outer `data` wrapper. Log-record events instead carry the (full)
 * log body at the top-level `body`, which `leanForProjection` tags with an
 * eventref whose field is `"body"`.
 */
const eventPayloadSchema = z.object({
  span: z
    .object({
      attributes: z.array(z.unknown()),
    })
    .optional(),
  body: z.string().optional(),
});

/**
 * The durable ADR-022 read path: a claim-check fetch of one offloaded field out
 * of the `event_log` row that recorded it.
 *
 * TenantId is the FIRST predicate in the WHERE clause, structurally blocking
 * cross-tenant reads.
 */
export class ClickHouseTraceEventPayloadRepository {
  static create(clickhouse: TraceClickHousePort): ClickHouseTraceEventPayloadRepository {
    return new ClickHouseTraceEventPayloadRepository(clickhouse);
  }

  private constructor(private readonly clickhouse: TraceClickHousePort) {}

  /**
   * Fetches a field value from the event_log ClickHouse table.
   *
   * @throws {TraceEventPayloadNotFoundError} When the SELECT returns no rows
   *   (including cross-tenant attempts).
   * @throws {TraceEventPayloadFieldNotFoundError} When the EventPayload parses
   *   successfully but the requested field is absent.
   * @throws {Error} When EventPayload JSON is corrupt.
   */
  async getField(input: {
    eventId: string;
    field: string;
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
  }): Promise<string> {
    const client = await this.clickhouse.resolve(input.tenantId);
    const payload = await this.readPayload(client, input);
    return extractField(payload, input.eventId, input.field);
  }

  private async readPayload(
    client: TraceClickHouseClient,
    input: {
      eventId: string;
      field: string;
      tenantId: string;
      aggregateType: string;
      aggregateId: string;
    },
  ): Promise<unknown> {
    // Prune partitions using the time embedded in the EventId itself. EventIds
    // are KSUIDs (generated by generateEventId), so the id we already look up by
    // carries its own creation timestamp — and EventOccurredAt is stamped from
    // the same ingestion clock (`Date.now()` at collection), so the KSUID time
    // lands in the same weekly partition. event_log is
    // PARTITION BY toYearWeek(EventOccurredAt), monotonic in EventOccurredAt, so
    // a window around that time prunes to the one or two weeks the row can live
    // in instead of walking every partition (cold ones tier to S3, turning each
    // blob read into a burst of S3 GETs).
    //
    // Deriving the bound from the id (rather than a caller-supplied time) keeps
    // this correct for every caller with nothing to thread, and avoids anchoring
    // on a different clock such as a span's start time, which can sit days
    // before the event's ingestion for late-arriving or replayed spans and would
    // then prune away the very partition holding the row.
    const occurredAtMs = parseKsuidCreatedAtMs(input.eventId);
    const occurredAtPredicate =
      occurredAtMs !== null
        ? `AND (
            EventOccurredAt = 0
            OR (
              EventOccurredAt >= {occurredAtFromMs:UInt64}
              AND EventOccurredAt <= {occurredAtToMs:UInt64}
            )
          )`
        : "";
    // Rows with an unknown occurred time (EventOccurredAt = 0, the column
    // default) are always kept so the window can never hide a present row.
    const occurredAtParams =
      occurredAtMs !== null
        ? {
            occurredAtFromMs: Math.max(
              0,
              Math.floor(occurredAtMs - EVENT_LOG_OCCURRED_AT_WINDOW_MS),
            ),
            occurredAtToMs: Math.floor(occurredAtMs + EVENT_LOG_OCCURRED_AT_WINDOW_MS),
          }
        : {};

    // TenantId MUST be the first predicate in the WHERE clause (ADR-022
    // cross-tenant denial).
    const result = await client.query<{ EventPayload: string }>({
      query: `
        SELECT EventPayload
        FROM event_log
        WHERE TenantId = {tenantId:String}
          AND AggregateType = {aggregateType:String}
          AND AggregateId = {aggregateId:String}
          AND EventId = {eventId:String}
          ${occurredAtPredicate}
        LIMIT 1
      `,
      query_params: {
        tenantId: input.tenantId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventId: input.eventId,
        ...occurredAtParams,
      },
      format: "JSONEachRow",
    });

    const rawRows = await result.json();
    if (!rawRows || rawRows.length === 0) {
      throw new TraceEventPayloadNotFoundError(input.eventId, input.field, input.tenantId);
    }

    const rowParse = eventLogRowSchema.safeParse(rawRows[0]);
    if (!rowParse.success) {
      throw new TraceEventPayloadNotFoundError(input.eventId, input.field, input.tenantId);
    }

    try {
      return JSON.parse(rowParse.data.EventPayload);
    } catch (e) {
      throw new Error(
        `Failed to parse EventPayload for eventId=${input.eventId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function extractField(parsedPayload: unknown, eventId: string, field: string): string {
  // ADR-022: EventPayload IS event.data (span/body at top level, no outer
  // `data` wrapper).
  const payloadParse = eventPayloadSchema.safeParse(parsedPayload);
  if (!payloadParse.success) {
    throw new TraceEventPayloadFieldNotFoundError(eventId, field);
  }

  // Log-record bodies: leanForProjection tags the log body with the eventref
  // field "body", and the full body lives at the top level of EventPayload
  // (not inside span.attributes). Resolve it directly.
  if (field === "body") {
    const body = payloadParse.data.body;
    if (typeof body !== "string") {
      throw new TraceEventPayloadFieldNotFoundError(eventId, field);
    }
    return body;
  }

  // Span attributes: extract by field name (the attribute key). EventPayload
  // holds raw OTLP attributes of mixed value types — parse each entry
  // defensively so a single non-string / malformed sibling attribute can never
  // mask the offloaded IO field (#4888).
  const spanAttributes = payloadParse.data.span?.attributes;
  if (!spanAttributes || spanAttributes.length === 0) {
    throw new TraceEventPayloadFieldNotFoundError(eventId, field);
  }

  for (const raw of spanAttributes) {
    const attr = spanAttributeSchema.safeParse(raw);
    if (!attr.success || attr.data.key !== field) continue;
    if (typeof attr.data.value.stringValue === "string") {
      return attr.data.value.stringValue;
    }
  }

  throw new TraceEventPayloadFieldNotFoundError(eventId, field);
}

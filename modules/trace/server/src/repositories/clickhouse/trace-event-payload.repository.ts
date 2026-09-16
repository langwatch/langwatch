import { Ksuid } from "@langwatch/ksuid";
import { z } from "zod";
import {
  TraceClickHouse,
  type TraceClickHouseClient,
  type TraceClickHouseResolver,
} from "../trace-clickhouse-client.repository.ts";

/**
 * The aggregate every offloaded trace field is stored under. `event_log` is
 * keyed by `(TenantId, AggregateType, AggregateId, EventId)`, so the wrong
 * type matches no row, returning the 64 KB preview — a silent degradation.
 */
export const TRACE_PAYLOAD_AGGREGATE_TYPE = "trace";

/** The tenant-keyed resolver a composition root holds, as the port the repository names. */
class ResolvedTraceClickHouse extends TraceClickHouse {
  constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  resolve(tenantId: string): Promise<TraceClickHouseClient> {
    return this.resolveClient(tenantId);
  }
}

/**
 * Half-width (ms) of the `EventOccurredAt` window for event_log blob reads.
 * KSUID creation time and `EventOccurredAt` share an ingestion clock, so ±2
 * days covers the skew while pruning to one or two weekly partitions.
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
 * Parses span attributes defensively, one per element, to avoid masking offloaded fields.
 */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});

/**
 * Parsed EventPayload structure: span at top level, no outer data wrapper.
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
 * The durable ADR-022 read path: a claim-check fetch of one offloaded field
 * out of the `event_log` row that recorded it. TenantId is the FIRST WHERE
 * predicate, structurally blocking cross-tenant reads.
 */
export class ClickHouseTraceEventPayloadRepository {
  static create(clickhouse: TraceClickHouse): ClickHouseTraceEventPayloadRepository {
    return new ClickHouseTraceEventPayloadRepository(clickhouse);
  }

  /** Built from a tenant-keyed resolver directly, for a composition root that holds no port. */
  static createResolved(options: {
    resolveClient: TraceClickHouseResolver;
  }): ClickHouseTraceEventPayloadRepository {
    return new ClickHouseTraceEventPayloadRepository(
      new ResolvedTraceClickHouse(options.resolveClient),
    );
  }

  private constructor(private readonly clickhouse: TraceClickHouse) {}

  /**
   * The event_log claim-check read behind the narrow port Trace declares.
   * Raises for a missing row, a missing field, a corrupt payload or an
   * unreachable cluster alike; the caller serves the preview instead.
   */
  async read(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    field: string;
  }): Promise<string> {
    return await this.getField({
      eventId: input.eventId,
      field: input.field,
      tenantId: input.tenantId,
      aggregateType: TRACE_PAYLOAD_AGGREGATE_TYPE,
      aggregateId: input.traceId,
    });
  }

  /**
   * Fetches a field value from event_log, raising on missing row or field.
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
    // Prune partitions using the KSUID timestamp embedded in EventId.
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
    const { stringValue } = attr.data.value;
    if (typeof stringValue === "string") {
      return stringValue;
    }
  }

  throw new TraceEventPayloadFieldNotFoundError(eventId, field);
}

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Ksuid } from "@langwatch/ksuid";
import { z } from "zod";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
}

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

/** Resolves the per-organization S3 client + bucket for a project. */
export type S3ClientResolver = (
  projectId: string,
) => Promise<S3ClientResolution>;

/**
 * Thrown by `BlobStore.getFromEventLog` when the requested row is not found or
 * the TenantId predicate returns no rows (including cross-tenant attempts).
 * ADR-022: TenantId in the WHERE clause structurally blocks cross-tenant reads.
 */
export class BlobNotFoundError extends Error {
  constructor(
    readonly eventId: string,
    readonly field: string,
    readonly tenantId: string,
  ) {
    super(
      `event_log row not found for eventId=${eventId} field=${field} tenantId=${tenantId}`,
    );
    this.name = "BlobNotFoundError";
  }
}

/**
 * Thrown by `BlobStore.getFromEventLog` when the requested `field` is not
 * present in the EventPayload. Indicates a corrupted event or a stale ref.
 */
export class BlobFieldNotFoundError extends Error {
  constructor(
    readonly key: string,
    readonly field: string,
  ) {
    super(`Field "${field}" not found in event payload at key ${key}`);
    this.name = "BlobFieldNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Zod schemas for parsing untyped external data (event_log EventPayload)
// ---------------------------------------------------------------------------

/** ClickHouse query response row from the event_log SELECT. */
const eventLogRowSchema = z.object({ EventPayload: z.string() });

/**
 * Span attribute entry inside EventPayload.
 *
 * EventPayload stores RAW OTLP spans (`EventPayload` IS `event.data`), whose
 * attribute `value` is an OTLP `AnyValue` oneof —
 * `stringValue | intValue | boolValue | doubleValue | arrayValue | kvlistValue |
 * bytesValue` (see schemas/otlp.ts). The read path only ever needs the offloaded
 * IO fields, which are stored as `stringValue`, so this schema reads ONLY
 * `stringValue` and leaves it optional.
 *
 * Critically, `span.attributes` is parsed PER-ELEMENT and defensively (see the
 * extraction loop in `getFromEventLog`): a single non-string or malformed
 * sibling attribute can never fail the whole-array parse and mask the offloaded
 * field. The old strict shape `value: { stringValue: z.string() }` rejected
 * EVERY real span that carried a numeric/boolean attribute (e.g.
 * `gen_ai.usage.input_tokens` = `{ intValue: "100" }`), which failed
 * `z.array(...)`, failed `eventPayloadSchema.safeParse`, and degraded every
 * > 64 KB read to the 64 KB preview (#4888).
 */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});

/**
 * Parsed EventPayload structure (ADR-022: full event as stored by the command worker).
 *
 * EventPayload IS event.data (stored as `event.data ?? {}` by eventToRecord).
 * The span write shape from recordSpanCommand is `{ span, resource, instrumentationScope }`
 * with the span at the TOP level — there is NO outer `data` wrapper. Log-record events
 * instead carry the (full) log body at the top-level `body`, which `leanForProjection`
 * tags with an eventref whose field is `"body"` (resolved by `getFromEventLog`).
 *
 * `span.attributes` is modeled as `z.array(z.unknown())` so a single malformed
 * or non-string sibling attribute can never fail the whole-array parse; each
 * entry is validated per-element by `spanAttributeSchema` in the extraction loop
 * below (#4888).
 */
const eventPayloadSchema = z.object({
  span: z
    .object({
      attributes: z.array(z.unknown()),
    })
    .optional(),
  body: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Transient spool S3 key shape (single source of truth)
// ---------------------------------------------------------------------------

/** Prefix for all transient spool object keys. */
const SPOOL_KEY_PREFIX = "trace-blobs/spool";
/** Leading "/"-segment count of SPOOL_KEY_PREFIX, so the decode index tracks the prefix. */
const SPOOL_PREFIX_SEGMENTS = SPOOL_KEY_PREFIX.split("/").length;

/** Builds a transient spool object key. The ONLY place the key shape is encoded. */
function buildSpoolKey(
  projectId: string,
  traceId: string,
  spanId: string,
): string {
  return `${SPOOL_KEY_PREFIX}/${projectId}/${traceId}/${spanId}`;
}

/**
 * Extracts the projectId from a spool key produced by {@link buildSpoolKey}.
 * Indexes off SPOOL_PREFIX_SEGMENTS so a change to the prefix can't silently
 * desync the encode (`putSpool`) and decode (`getSpool`/`deleteSpool`) paths.
 */
function projectIdFromSpoolKey(spoolRef: string): string {
  return spoolRef.split("/")[SPOOL_PREFIX_SEGMENTS] ?? "";
}

/**
 * Provides transient S3 spool operations (ADR-022 write path) and event_log
 * read operations (ADR-022 read path).
 *
 * Spool: a per-span transient S3 object used to carry over-threshold command
 * payloads from the edge to the command worker. Eagerly deleted after the
 * event_log INSERT succeeds; 3-day lifecycle policy as safety net for orphans
 * (3 days covers weekend incidents that need catch-up time).
 *
 * Event log: the durable source of truth. `getFromEventLog` performs a
 * SELECT on `event_log` keyed by (TenantId, AggregateType, AggregateId,
 * EventId). TenantId is the FIRST predicate, structurally blocking
 * cross-tenant reads. ADR-022.
 */
export class BlobStore {
  /**
   * @param resolveS3Client - Resolver for per-org S3 client + bucket.
   * @param resolveClickHouseClient - Optional per-tenant ClickHouseClient resolver for ADR-022
   *   event_log reads. When provided, `getFromEventLog` resolves the correct client for the
   *   given tenantId (supporting multi-cluster tenants). When absent, `getFromEventLog` throws
   *   "ClickHouseClient not configured".
   */
  constructor(
    private readonly resolveS3Client: S3ClientResolver,
    private readonly resolveClickHouseClient?: ClickHouseClientResolver,
  ) {}

  /**
   * Fetches a field value from the event_log ClickHouse table (ADR-022 read path).
   *
   * Issues a SELECT on `event_log` by `(TenantId, AggregateType, AggregateId, EventId)` —
   * the TenantId is the FIRST predicate in the WHERE clause, structurally blocking
   * cross-tenant reads. Parses `EventPayload` JSON, extracts the named field, and returns it.
   *
   * @throws {BlobNotFoundError} When the SELECT returns no rows (including cross-tenant attempts).
   * @throws {BlobFieldNotFoundError} When the EventPayload parses successfully but the
   *   requested field is absent.
   * @throws {Error} When EventPayload JSON is corrupt or ClickHouseClient is not configured.
   */
  async getFromEventLog({
    eventId,
    field,
    tenantId,
    aggregateType,
    aggregateId,
  }: {
    eventId: string;
    field: string;
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
  }): Promise<string> {
    if (!this.resolveClickHouseClient) {
      throw new Error(
        "ClickHouseClient not configured — cannot read from event_log (ADR-022)",
      );
    }

    const clickHouseClient = await this.resolveClickHouseClient(tenantId);

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
    const occurredAtMs = parseKsuidCreatedAtMs(eventId);
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
            occurredAtToMs: Math.floor(
              occurredAtMs + EVENT_LOG_OCCURRED_AT_WINDOW_MS,
            ),
          }
        : {};

    // TenantId MUST be the first predicate in the WHERE clause (ADR-022 cross-tenant denial).
    const result = await clickHouseClient.query({
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
        tenantId,
        aggregateType,
        aggregateId,
        eventId,
        ...occurredAtParams,
      },
    });

    const response = await result.json<unknown>();
    const rawRows = (response as { data?: unknown[] } | null)?.data;

    if (!rawRows || rawRows.length === 0) {
      throw new BlobNotFoundError(eventId, field, tenantId);
    }

    const rowParse = eventLogRowSchema.safeParse(rawRows[0]);
    if (!rowParse.success) {
      throw new BlobNotFoundError(eventId, field, tenantId);
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rowParse.data.EventPayload);
    } catch (e) {
      throw new Error(
        `Failed to parse EventPayload for eventId=${eventId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // ADR-022: EventPayload IS event.data (span/body at top level, no outer `data` wrapper).
    const payloadParse = eventPayloadSchema.safeParse(parsedPayload);
    if (!payloadParse.success) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    // Log-record bodies: leanForProjection tags the log body with the eventref
    // field "body", and the full body lives at the top level of EventPayload
    // (not inside span.attributes). Resolve it directly.
    if (field === "body") {
      const body = payloadParse.data.body;
      if (typeof body !== "string") {
        throw new BlobFieldNotFoundError(eventId, field);
      }
      return body;
    }

    // Span attributes: extract by field name (the attribute key). EventPayload
    // holds raw OTLP attributes of mixed value types — parse each entry
    // defensively so a single non-string / malformed sibling attribute can
    // never mask the offloaded IO field (#4888).
    const spanAttributes = payloadParse.data.span?.attributes;
    if (!spanAttributes || spanAttributes.length === 0) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    for (const raw of spanAttributes) {
      const attr = spanAttributeSchema.safeParse(raw);
      if (!attr.success || attr.data.key !== field) continue;
      if (typeof attr.data.value.stringValue === "string") {
        return attr.data.value.stringValue;
      }
    }

    throw new BlobFieldNotFoundError(eventId, field);
  }

  /**
   * Fetches the full span body from a transient S3 spool object.
   * Called by the command worker when a command carries a `spoolRef`.
   *
   * The spool key is the raw S3 object key (no bucket prefix). The S3 bucket is
   * resolved via the key's projectId segment (decoded by `projectIdFromSpoolKey`).
   *
   * @param spoolRef - The spool reference string (S3 key) returned by `putSpool`.
   * @returns The raw body buffer as stored by `putSpool`.
   * @throws {Error} If S3 returns a response with no body — surfaced here so the
   *   failure is legible rather than an opaque downstream parse error on an empty buffer.
   * @throws The underlying S3 error if the object does not exist or access fails.
   */
  async getSpool(spoolRef: string): Promise<Buffer> {
    const projectId = projectIdFromSpoolKey(spoolRef);
    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: spoolRef }),
    );
    const bytes = await Body?.transformToByteArray();
    if (bytes == null) {
      throw new Error(
        `Spool object returned no body from S3 (key=${spoolRef}) — cannot reconstitute command`,
      );
    }
    return Buffer.from(bytes);
  }

  /**
   * Writes a transient S3 spool object for an over-threshold command payload.
   * Returns the spool reference string (the S3 key) that the command will carry.
   *
   * Key shape: `trace-blobs/spool/{projectId}/{traceId}/{spanId}` — transient,
   * eagerly DELETEd after event_log INSERT succeeds. Bucket MUST have a 3-day
   * lifecycle policy as a safety net for orphans (covers weekend incidents).
   */
  async putSpool({
    projectId,
    traceId,
    spanId,
    body,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    body: Buffer;
  }): Promise<string> {
    const key = buildSpoolKey(projectId, traceId, spanId);
    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
      }),
    );
    return key;
  }

  /**
   * Best-effort deletion of a transient S3 spool object.
   * Called after event_log INSERT succeeds. Errors are swallowed — the 3-day lifecycle
   * policy is the safety net for orphans. Returns void in all cases.
   *
   * @param spoolRef - The spool reference string returned by `putSpool`.
   * @throws Never — all errors are swallowed internally.
   */
  async deleteSpool(spoolRef: string): Promise<void> {
    try {
      const projectId = projectIdFromSpoolKey(spoolRef);
      const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: s3Bucket, Key: spoolRef }),
      );
    } catch {
      // Best-effort — swallow all errors; lifecycle policy is the safety net.
    }
  }
}

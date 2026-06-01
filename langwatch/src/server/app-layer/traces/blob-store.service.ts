import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
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
  constructor(readonly key: string, readonly field: string) {
    super(`Field "${field}" not found in event payload at key ${key}`);
    this.name = "BlobFieldNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Zod schemas for parsing untyped external data (event_log EventPayload)
// ---------------------------------------------------------------------------

/** ClickHouse query response row from the event_log SELECT. */
const eventLogRowSchema = z.object({ EventPayload: z.string() });

/** Span attribute entry inside EventPayload. */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string() }),
});

/** Parsed EventPayload structure (ADR-022: full event as stored by the command worker). */
const eventPayloadSchema = z.object({
  data: z
    .object({
      span: z
        .object({
          attributes: z.array(spanAttributeSchema),
        })
        .optional(),
    })
    .optional(),
});

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

    // TenantId MUST be the first predicate in the WHERE clause (ADR-022 cross-tenant denial).
    const result = await clickHouseClient.query({
      query: `
        SELECT EventPayload
        FROM event_log
        WHERE TenantId = {tenantId:String}
          AND AggregateType = {aggregateType:String}
          AND AggregateId = {aggregateId:String}
          AND EventId = {eventId:String}
        LIMIT 1
      `,
      query_params: { tenantId, aggregateType, aggregateId, eventId },
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

    // Extract span attribute by field name from the parsed EventPayload.
    // ADR-022: EventPayload contains the full event as stored by the command worker.
    const payloadParse = eventPayloadSchema.safeParse(parsedPayload);
    const spanAttributes = payloadParse.success
      ? payloadParse.data.data?.span?.attributes
      : undefined;

    if (!spanAttributes || spanAttributes.length === 0) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    const attr = spanAttributes.find((a) => a.key === field);

    if (!attr) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    return attr.value.stringValue;
  }

  /**
   * Fetches the full span body from a transient S3 spool object.
   * Called by the command worker when a command carries a `spoolRef`.
   *
   * The spool key is the raw S3 object key (no bucket prefix). The S3 bucket
   * is resolved via the spool key's project segment. For the transient spool shape
   * (`trace-blobs/spool/{projectId}/{traceId}/{spanId}`), the projectId is at
   * index 2 of the key split by "/".
   *
   * @param spoolRef - The spool reference string (S3 key) returned by `putSpool`.
   * @returns The raw body buffer as stored by `putSpool`.
   * @throws The underlying S3 error if the object does not exist or access fails.
   */
  async getSpool(spoolRef: string): Promise<Buffer> {
    // Extract projectId from the spool key: trace-blobs/spool/{projectId}/...
    const projectId = spoolRef.split("/")[2] ?? "";
    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: spoolRef }),
    );
    const bytes = await Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
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
    const key = `trace-blobs/spool/${projectId}/${traceId}/${spanId}`;
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
      const projectId = spoolRef.split("/")[2] ?? "";
      const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: s3Bucket, Key: spoolRef }),
      );
    } catch {
      // Best-effort — swallow all errors; lifecycle policy is the safety net.
    }
  }
}

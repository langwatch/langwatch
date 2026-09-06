import { TraceStreamBufferService } from "./trace-stream-buffer.service";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "@langwatch/observability";
import {
  assertLegacySpoolKeyBelongsTo,
  buildSpoolObjectPath,
  isLegacySpoolRef,
  SPOOL_REF_V2,
} from "../rules/trace-spool-location.rules";
import {
  eventLogOccurredAtWindow,
  eventLogRowSchema,
  eventPayloadSchema,
  readEventPayloadField,
} from "../rules/trace-event-log-payload.rules";
/**
 * The one read this store issues, in the default JSON format. Declared here rather than taken from
 * the package client, which pins JSONEachRow: this read consumes the envelope the default format
 * answers with, and switching would make every offloaded value read as not found.
 */
interface BlobStoreClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
  }): Promise<{ json(): Promise<unknown> }>;
}

type ClickHouseClientResolver = (tenantId: string) => Promise<BlobStoreClickHouseClient>;
import type { StoredObjectStorageDestination as ProjectStorageDestination } from "@langwatch/stored-object-contract";
import { mintStoredObjectUri } from "@langwatch/stored-object-contract";

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
}

/**
 * Cap on a spool object read. The spool holds one over-threshold command and the attribute cap
 * already bounds a span well below this, so the cap exists to stop a corrupt object OOMing the
 * worker rather than to enforce a product limit.
 */
export const MAX_SPOOL_BYTES = 50 * 1024 * 1024;

/**
 * The slice of the stored-objects registry the spool needs. Declared here
 * rather than imported so this module depends on a shape, not on the registry
 * class — the registry satisfies it structurally.
 */
export interface SpoolObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

/**
 * Destination-agnostic storage for the trace spool, injected so `TraceBlobStoreService`
 * carries no env coupling and the tests run without infrastructure.
 */
export interface SpoolStorage {
  /** Per-project so BYOC tenants resolve their own bucket and credentials. */
  objectStoreFor(projectId: string): SpoolObjectStore;
  resolveDestination(projectId: string): Promise<ProjectStorageDestination>;
  /**
   * The operator's assertion that the Azure container has the orphan-reaping
   * lifecycle rule. Injected rather than read from env here so this class keeps
   * its no-env-coupling property; the composition root owns the env read.
   */
  azureRetentionConfirmed: boolean;
}

/** Resolves the per-organization S3 client + bucket for a project. */
export type S3ClientResolver = (projectId: string) => Promise<S3ClientResolution>;

/**
 * Thrown by `TraceBlobStoreService.getFromEventLog` when the requested row is not found or
 * the TenantId predicate returns no rows (including cross-tenant attempts).
 * ADR-022: TenantId in the WHERE clause structurally blocks cross-tenant reads.
 */
export class BlobNotFoundError extends Error {
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
 * Thrown by `TraceBlobStoreService.getFromEventLog` when the requested `field` is not
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

/**
 * Raised when the project's storage destination cannot host the spool. Distinct
 * from a storage failure so the fail-open warn can say "this deployment has no
 * spool" rather than implying an outage the operator should go chase.
 */
export class SpoolDestinationUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpoolDestinationUnsupportedError";
  }
}

/**
 * Refuses a destination that cannot bound an orphaned spool object. Write path only: a rule about
 * creating new objects, not about the ones already out there.
 */
function assertDestinationCanHostSpool({
  destination,
  azureRetentionConfirmed,
}: {
  destination: ProjectStorageDestination;
  azureRetentionConfirmed: boolean;
}): void {
  // The spool depends on something outside the store to stay bounded: eager delete after
  // event_log INSERT, plus a lifecycle rule reaping whatever a crash between the two leaves. A
  // filesystem has no such rule, so here an orphan is permanent.
  if (destination.kind === "file") {
    throw new SpoolDestinationUnsupportedError(
      "The trace spool has no local-filesystem path: orphaned spool objects are reaped by a " +
        "bucket/container lifecycle rule, which a filesystem cannot express, so a crash between " +
        "the write and its delete would leave the object forever. Ingestion continues with the " +
        "full payload inline. Configure S3 or Azure Blob storage to get oversize protection.",
    );
  }

  // Same rule, applied consistently. Azure CAN express the lifecycle policy
  // the orphan bound depends on, but nothing here can confirm it exists —
  // the policy is a MANAGEMENT-plane resource this deployment's data-plane
  // key can't read. The operator asserts it at deploy time (default off);
  // enabling without provisioning retention degrades to inline payloads.
  if (destination.kind === "azure" && !azureRetentionConfirmed) {
    throw new SpoolDestinationUnsupportedError(
      "The trace spool is disabled on Azure Blob until orphan retention is provisioned. A crash " +
        "between the spool write and its delete leaves the object behind, and only a lifecycle " +
        "rule reaps it. Create a lifecycle management policy on this container that deletes " +
        "blobs under the `trace-blobs/spool/` prefix after 3 days, then set " +
        "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED=true (chart: " +
        "`app.dataplane.providers.azureBlob.spoolRetentionConfirmed`). Ingestion continues with " +
        "the full payload inline until then.",
    );
  }
}

/**
 * @see ADR-022
 * Transient spool operations on the write path and event_log reads on the read path; a spool object
 * is deleted after the INSERT. Event log reads select TenantId first, blocking a cross-tenant read.
 */
export class TraceBlobStoreService {
  static create(options: {
    resolveS3Client: S3ClientResolver;
    resolveClickHouseClient?: ClickHouseClientResolver;
    spoolStorage?: SpoolStorage;
    logger?: Logger;
  }): TraceBlobStoreService {
    return new TraceBlobStoreService(options);
  }

  /**
   * `resolveS3Client` reads back v1 spool refs only, new writes going through the object store.
   * `resolveClickHouseClient` is the per-tenant client event_log reads need; without it those
   * reads throw. `spoolStorage` backs spool writes, and `logger` surfaces a refused delete.
   */
  private readonly resolveS3Client: S3ClientResolver;
  private readonly resolveClickHouseClient?: ClickHouseClientResolver;
  private readonly spoolStorage?: SpoolStorage;
  private readonly logger?: Logger;

  private constructor({
    resolveS3Client,
    resolveClickHouseClient,
    spoolStorage,
    logger,
  }: {
    resolveS3Client: S3ClientResolver;
    resolveClickHouseClient?: ClickHouseClientResolver;
    spoolStorage?: SpoolStorage;
    logger?: Logger;
  }) {
    this.resolveS3Client = resolveS3Client;
    this.resolveClickHouseClient = resolveClickHouseClient;
    this.spoolStorage = spoolStorage;
    this.logger = logger;
  }

  /**
   * Re-derives the spool object's URI from server-trusted inputs, never a location out of the
   * command. `purpose` gates the destination guards, a write-time rule only: applying them to a
   * read would make in-flight spooled spans unreadable and manufacture the orphan they prevent.
   */
  private async mintSpoolUri({
    projectId,
    traceId,
    spanId,
    purpose,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    purpose: "write" | "access";
  }): Promise<{ uri: string; objectStore: SpoolObjectStore }> {
    if (!this.spoolStorage) {
      throw new Error(
        "TraceBlobStoreService has no spool storage configured — cannot resolve the trace spool destination.",
      );
    }

    const destination = await this.spoolStorage.resolveDestination(projectId);

    if (purpose === "write") {
      assertDestinationCanHostSpool({
        destination,
        azureRetentionConfirmed: this.spoolStorage.azureRetentionConfirmed,
      });
    }

    return {
      uri: mintStoredObjectUri({
        destination,
        objectPath: buildSpoolObjectPath({ projectId, traceId, spanId }),
      }),
      objectStore: this.spoolStorage.objectStoreFor(projectId),
    };
  }

  /**
   * Fetches a field value from event_log (ADR-022 read path). SELECTs by (TenantId,
   * AggregateType, AggregateId, EventId), TenantId first, blocking cross-tenant reads.
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
      throw new Error("ClickHouseClient not configured — cannot read from event_log (ADR-022)");
    }

    const clickHouseClient = await this.resolveClickHouseClient(tenantId);
    const window = eventLogOccurredAtWindow(eventId);
    // TenantId must be the first predicate in the WHERE clause (ADR-022 cross-tenant denial).
    const result = await clickHouseClient.query({
      query: `
        SELECT EventPayload
        FROM event_log
        WHERE TenantId = {tenantId:String}
          AND AggregateType = {aggregateType:String}
          AND AggregateId = {aggregateId:String}
          AND EventId = {eventId:String}
          ${window.predicate}
        LIMIT 1
      `,
      query_params: {
        tenantId,
        aggregateType,
        aggregateId,
        eventId,
        ...window.params,
      },
    });

    const response = await result.json();
    const rawRows = (response as { data?: unknown[] } | null)?.data;
    const rowParse = rawRows?.[0] ? eventLogRowSchema.safeParse(rawRows[0]) : null;
    if (!rowParse?.success) {
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

    // ADR-022: EventPayload is the event's own data, with the span or body at the top level.
    const payloadParse = eventPayloadSchema.safeParse(parsedPayload);
    if (!payloadParse.success) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    const value = readEventPayloadField(payloadParse.data, field);
    if (value === null) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    return value;
  }

  /**
   * Location is re-derived from projectId/traceId/spanId (queue-authenticated), never spoolRef,
   * so a tampered reference can't redirect this read. NOT fail-open, since the edge already
   * cleared span.attributes before spooling.
   */
  async getSpool({
    spoolRef,
    projectId,
    traceId,
    spanId,
  }: {
    spoolRef: string;
    projectId: string;
    traceId: string;
    spanId: string;
  }): Promise<Buffer> {
    if (isLegacySpoolRef(spoolRef)) {
      assertLegacySpoolKeyBelongsTo(spoolRef, projectId);

      return this.getLegacySpool(spoolRef, projectId);
    }

    const { uri, objectStore } = await this.mintSpoolUri({
      projectId,
      traceId,
      spanId,
      purpose: "access",
    });

    return TraceStreamBufferService.streamToBuffer(await objectStore.get(uri), MAX_SPOOL_BYTES);
  }

  /**
   * v1 read path: the reference IS the S3 key. Retained for one release so
   * commands queued across the deploy still resolve. See {@link isLegacySpoolRef}.
   */
  private async getLegacySpool(spoolRef: string, projectId: string): Promise<Buffer> {
    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    const { Body } = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: spoolRef }));
    if (!Body) {
      throw new Error(
        `Spool object returned no body from S3 (key=${spoolRef}) — cannot reconstitute command`,
      );
    }

    // Read through the same bounded helper the v2 path uses. `transformToByteArray()`
    // buffers the whole object first, so it would have skipped MAX_SPOOL_BYTES
    // entirely — and a v1 reference points at an object written before this
    // deploy, which is exactly the input the cap exists to distrust.
    return TraceStreamBufferService.streamToBuffer(Body as unknown as Readable, MAX_SPOOL_BYTES);
  }

  /**
   * Writes the transient spool object for an over-threshold command and returns the reference the
   * command carries. It lands at whichever backend the project's storage destination names and is
   * deleted after the event_log INSERT; that prefix must carry a three-day lifecycle rule.
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
    const { uri, objectStore } = await this.mintSpoolUri({
      projectId,
      traceId,
      spanId,
      purpose: "write",
    });
    await objectStore.put(uri, body, "application/octet-stream");

    return SPOOL_REF_V2;
  }

  /**
   * Best-effort deletion of the transient spool object, called after the event_log INSERT succeeds.
   * Errors are swallowed and never thrown — the three-day lifecycle rule is the orphan safety net.
   */
  async deleteSpool({
    spoolRef,
    projectId,
    traceId,
    spanId,
  }: {
    spoolRef: string;
    projectId: string;
    traceId: string;
    spanId: string;
  }): Promise<void> {
    try {
      if (isLegacySpoolRef(spoolRef)) {
        // A refusal here is a tamper indicator, not a storage blip. The
        // best-effort swallow below is meant for the latter, so log this one
        // explicitly rather than letting it disappear into the same catch.
        try {
          assertLegacySpoolKeyBelongsTo(spoolRef, projectId);
        } catch {
          this.logger?.warn(
            { projectId, traceId, spanId },
            "Refused a cross-tenant v1 spool delete",
          );

          return;
        }

        const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
        await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: spoolRef }));

        return;
      }

      const { uri, objectStore } = await this.mintSpoolUri({
        projectId,
        traceId,
        spanId,
        purpose: "access",
      });
      await objectStore.delete(uri);
    } catch {
      // Best-effort — swallow all errors; lifecycle policy is the safety net.
    }
  }
}

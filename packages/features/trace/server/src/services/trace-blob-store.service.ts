import { TraceStreamBufferService } from "./trace-stream-buffer.service";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Ksuid } from "@langwatch/ksuid";
import type { Logger } from "@langwatch/observability";
import { z } from "zod";
/**
 * The one read this store issues, in the DEFAULT JSON format. Declared here rather than taken from the package's TraceClickHouseClient, which pins format:"JSONEachRow": this read consumes response.data, the envelope the default format answers with, and switching would leave every offloaded value reading as "not found" while the query itself still succeeded.
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
 * Cap on a spool object read. The spool holds one over-threshold command, and capOversizedAttributes already bounds a span well below this — the cap exists so a tampered/corrupt object can't OOM the worker, not to enforce a product limit.
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

/**
 * Half-width (ms) of the EventOccurredAt window for event_log blob reads. KSUID creation time and EventOccurredAt are stamped from the same ingestion clock, landing within queue lag of each other; ±2 days comfortably covers that skew while pruning to the one or two weekly partitions the row can live in. Matches the ±2-day span partition hint on the trace-fetch path.
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

/** ClickHouse query response row from the event_log SELECT. */
const eventLogRowSchema = z.object({ EventPayload: z.string() });

/**
 * Span attribute entry inside EventPayload. EventPayload stores RAW OTLP spans (IS event.data), whose attribute value is an OTLP AnyValue oneof; the read path only needs offloaded IO fields (stored as stringValue), so this schema reads ONLY stringValue, optional. Critically, span.attributes is parsed PER-ELEMENT and defensively (getFromEventLog's extraction loop) — a malformed sibling can never fail the whole-array parse and mask the offloaded field. The old strict shape rejected EVERY span carrying a numeric/boolean attribute (e.g. gen_ai.usage.input_tokens={intValue}), degrading every >64KB read to the 64KB preview (#4888).
 */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});

/**
 * @see ADR-022
 * Parsed EventPayload structure (full event as stored by the command worker). EventPayload IS event.data; the span write shape is {span, resource, instrumentationScope} at the TOP level, no outer data wrapper. Log-record events carry the full body at top-level body, tagged by leanForProjection with a "body" eventref. span.attributes is z.array(z.unknown()) so a malformed sibling can never fail the whole-array parse; each entry validates per-element via spanAttributeSchema below (#4888).
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
// Transient spool object path (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Prefix for all transient spool objects, kept at the TOP of the object path (above the tenant segment) so a lifecycle rule can match it with a plain prefix filter — S3 lifecycle filters can't wildcard a leading tenant segment, so a tenant-first path would be unexpirable and orphans would accumulate forever. Do not reorder.
 */
const SPOOL_KEY_PREFIX = "trace-blobs/spool";

/**
 * Marker carried by a spooled command instead of a storage path. v1 put the raw object key in the command and the read path parsed the tenant id back out to pick a bucket, so an influenced queue message could steer a read at another tenant's object. v2 carries no location — getSpool/deleteSpool re-derive it from the command's own trusted tenantId + span ids, exactly as putSpool derived it (same discipline as TieredBlobStore's BlobRef).
 */
export const SPOOL_REF_V2 = "spool:v2";

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
 * Ids that are safe to use verbatim as one path segment: the normal case, since
 * OTLP ids normalise to hex. Excludes `.` and `..` explicitly — both match the
 * character class but are directory references, not names.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Reduces one id to a single path component. Percent-encoding alone isn't enough: it survives URI construction, but LocalFilesystemDriver.parseFileUri round-trips through decodeURIComponent, turning ..%2F..%2F back into ../../ before mkdir/writeFile see it, so an id of ../../... could escape the object root (idSchema accepts arbitrary strings). Anything outside the safe class is replaced by a HASH of the id, not escaped — a hash can't contain a separator or .. no matter what decodes it downstream, and stays deterministic so read/delete re-derive the identical location. Ordinary hex ids stay legible in a listing.
 */
function safePathSegment(id: string): string {
  if (SAFE_PATH_SEGMENT.test(id) && id !== "." && id !== "..") {
    return id;
  }

  return createHash("sha256").update(id, "utf8").digest("hex");
}

/**
 * Builds the transient spool object path. The ONLY place the shape is encoded.
 */
function buildSpoolObjectPath({
  projectId,
  traceId,
  spanId,
}: {
  projectId: string;
  traceId: string;
  spanId: string;
}): string {
  return [
    SPOOL_KEY_PREFIX,
    safePathSegment(projectId),
    safePathSegment(traceId),
    safePathSegment(spanId),
  ].join("/");
}

/**
 * True when spoolRef has the v1 shape — a raw S3 key minted before this deployment; in-flight commands still carry these, so both formats must resolve for one release. Matched by PREFIX, not "not v2" — treating every unrecognised string as v1 would re-dereference the very thing this change removes; an unrecognised reference falls through to v2, where location is derived and the reference ignored.
 * TODO(langwatch-saas#837): drop the v1 branch one release after this ships (spool lifecycle expiry is 3 days).
 */
function isLegacySpoolRef(spoolRef: string): boolean {
  return spoolRef.startsWith(`${SPOOL_KEY_PREFIX}/`);
}

/**
 * Extracts the projectId segment from a v1 spool key. Caller must check it against the command's authenticated tenant before dereferencing — see {@link assertLegacySpoolKeyBelongsTo}.
 */
function projectIdFromLegacySpoolKey(spoolRef: string): string {
  return spoolRef.split("/")[SPOOL_KEY_PREFIX.split("/").length] ?? "";
}

/**
 * Refuses a v1 key whose tenant segment isn't the tenant the command was authenticated as. v1 is the one place a location still travels inside the command, so it's the one place a tampered reference could steer a read — pinning it to the command's own tenant keeps the compatibility window from reopening the hole v2 closes.
 */
function assertLegacySpoolKeyBelongsTo(spoolRef: string, projectId: string): void {
  const keyProjectId = projectIdFromLegacySpoolKey(spoolRef);
  if (keyProjectId !== projectId) {
    throw new Error(
      `Refusing to read spool object: reference names tenant "${keyProjectId}" but the command is authenticated as "${projectId}".`,
    );
  }
}

/**
 * Refuses a destination that cannot bound an orphaned spool object. WRITE PATH ONLY — a rule about creating new objects, not the ones already out there (see the purpose note on mintSpoolUri).
 */
function assertDestinationCanHostSpool({
  destination,
  azureRetentionConfirmed,
}: {
  destination: ProjectStorageDestination;
  azureRetentionConfirmed: boolean;
}): void {
  // The spool is the one stored-objects consumer depending on something
  // OUTSIDE the store to stay bounded: eager delete after event_log INSERT,
  // plus a lifecycle rule reaping whatever a crash between the two leaves.
  // A filesystem has no such rule, so here an orphan is permanent. Refusing
  // is not a regression — before this moved onto the shared layer it hit a hardcoded nonexistent bucket and silently fell open to inline payloads.
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
 * Transient spool operations (write path) + event_log read operations (read path). Spool: a per-span transient object carrying over-threshold command payloads from edge to worker, eagerly deleted after the event_log INSERT, with a 3-day lifecycle policy as an orphan safety net (covers weekend incidents). Spool writes go through the shared stored-objects layer, landing wherever the project's storage destination points (S3/Azure/local) — used to speak the AWS SDK directly, silently ignoring Azure configs (langwatch-saas#800). Event log: the durable source of truth — getFromEventLog SELECTs by (TenantId, AggregateType, AggregateId, EventId), TenantId FIRST, structurally blocking cross-tenant reads.
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
   * @param resolveS3Client - Reads back v1 spool refs only; new writes use objectStoreFor.
   * @param resolveClickHouseClient - Optional per-tenant CH client for event_log reads; absent, getFromEventLog throws.
   * @param spoolStorage - Object store for spool writes (absent throws; maybeSpool degrades to inline). @param logger - optional, surfaces a refused cross-tenant delete.
   */
  private readonly resolveS3Client: S3ClientResolver;
  private readonly resolveClickHouseClient?: ClickHouseClientResolver;
  private readonly spoolStorage?: SpoolStorage;
  private readonly logger?: Logger;

  constructor({
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
   * Re-derives the spool object's URI from server-trusted inputs, never a location out of the command. purpose gates the destination guards below, a WRITE-time rule only: applying them to a read/delete would punish objects already on disk — an operator flipping the retention assertion back off (documented remediation, what a chart rollback does) would make every in-flight spooled span permanently unreadable and stop the eager delete, manufacturing exactly the orphan the guard prevents.
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
   * Fetches a field value from event_log (ADR-022 read path). SELECTs by
   * (TenantId, AggregateType, AggregateId, EventId), TenantId FIRST, blocking cross-tenant reads. Parses EventPayload JSON, extracts the named field.
   * @throws {BlobNotFoundError} No rows. @throws {BlobFieldNotFoundError} Field absent. @throws {Error} Corrupt JSON / no ClickHouseClient.
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

    // Prunes partitions using the time embedded in the EventId (a KSUID, so
    // it carries its own creation timestamp matching EventOccurredAt's
    // ingestion clock). event_log is PARTITION BY toYearWeek(EventOccurredAt),
    // so a window around that time prunes to the weeks the row can live in.
    // Derived from the id, not a caller-supplied time, so it's correct with nothing to thread.
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
            occurredAtToMs: Math.floor(occurredAtMs + EVENT_LOG_OCCURRED_AT_WINDOW_MS),
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

    const response = await result.json();
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
      if (!attr.success || attr.data.key !== field) {
        continue;
      }

      if (typeof attr.data.value.stringValue === "string") {
        return attr.data.value.stringValue;
      }
    }

    throw new BlobFieldNotFoundError(eventId, field);
  }

  /**
   * Fetches the full span body from the transient spool object. Location is
   * re-derived from projectId/traceId/spanId (queue-authenticated), never
   * spoolRef, so a tampered reference can't redirect this read. NOT fail-open, since the edge already cleared span.attributes before spooling.
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
   * Writes the transient spool object for an over-threshold command and returns the reference the command carries. Lands at whichever backend the project's storage destination names, path trace-blobs/spool/{projectId}/{traceId}/{spanId}, eagerly deleted after event_log INSERT; the bucket/container MUST have a 3-day lifecycle rule on that prefix as the orphan safety net.
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
   * Best-effort deletion of the transient spool object, called after event_log INSERT succeeds. Errors are swallowed — the 3-day lifecycle rule is the orphan safety net.
   * @throws Never — all errors swallowed internally.
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

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Ksuid } from "@langwatch/ksuid";
import type { Logger } from "@langwatch/observability";
import { z } from "zod";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { ProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { mintUriForDestination } from "~/server/stored-objects/uri";
import { streamToBuffer } from "~/utils/streamToBuffer";

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
}

/**
 * Cap on a spool object read. The spool holds one over-threshold command, and
 * `capOversizedAttributes` already bounds a span well below this — the cap
 * exists so a tampered or corrupt object cannot OOM the worker, not to enforce
 * a product limit.
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
 * Destination-agnostic storage for the trace spool, injected so `BlobStore`
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
// Transient spool object path (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Prefix for all transient spool objects, kept at the TOP of the object path
 * (above the tenant segment) so a bucket/container lifecycle rule can match it
 * with a plain prefix filter. S3 lifecycle prefix filters cannot wildcard a
 * leading tenant segment, so `{projectId}/trace-blobs/spool/…` would be
 * unexpirable and orphans would accumulate forever. Do not reorder.
 */
const SPOOL_KEY_PREFIX = "trace-blobs/spool";

/**
 * Marker carried by a spooled command instead of a storage path.
 *
 * The v1 format put the raw object key in the command and the read path parsed
 * the tenant id back out of that string to pick a bucket — so whoever could
 * influence the queue message could steer a read at another tenant's object.
 * v2 carries no location at all: `getSpool`/`deleteSpool` re-derive it from the
 * command's own trusted `tenantId` + span ids, exactly as `putSpool` derived it
 * (the same discipline `TieredBlobStore`'s `BlobRef` follows — ADR-030 §5).
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
 * Reduces one id to a single path component.
 *
 * Percent-encoding is NOT sufficient on its own. It survives URI construction,
 * but `LocalFilesystemDriver.parseFileUri` round-trips through
 * `decodeURIComponent`, which turns `..%2F..%2F` straight back into `../../`
 * before `mkdir`/`writeFile` see it — so an id of `../../…` escaped the object
 * root entirely. `idSchema` accepts arbitrary strings, so anyone able to ingest
 * a span could pick that path.
 *
 * Anything outside the safe class is replaced by a hash of the id rather than
 * escaped: a hash cannot contain a separator or a `..` no matter what decodes
 * it downstream, and it stays deterministic, so the read and delete paths
 * re-derive the identical location. Ordinary hex ids are untouched and remain
 * legible in a bucket listing.
 */
function safePathSegment(id: string): string {
  if (SAFE_PATH_SEGMENT.test(id) && id !== "." && id !== "..") return id;
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
 * True when `spoolRef` has the shape of a v1 reference — a raw S3 key minted
 * before this deployment. Commands already queued when the new code rolls out
 * still carry these, so both formats must resolve for one release.
 *
 * Matched by prefix rather than by "not v2": treating every unrecognised string
 * as a v1 key would send it to the raw bucket+key read below, which is the very
 * dereference this change exists to remove. An unrecognised reference instead
 * falls through to the v2 path, where the location is derived and the reference
 * ignored.
 *
 * TODO(langwatch/langwatch-saas#837): drop the v1 branch one release after this
 * ships. By then no in-flight command can still carry a v1 ref — the spool's
 * own lifecycle expiry is 3 days, so nothing can resolve one after that.
 */
function isLegacySpoolRef(spoolRef: string): boolean {
  return spoolRef.startsWith(`${SPOOL_KEY_PREFIX}/`);
}

/**
 * Extracts the projectId segment from a v1 spool key.
 *
 * The caller must check it against the command's authenticated tenant before
 * dereferencing — see {@link assertLegacySpoolKeyBelongsTo}.
 */
function projectIdFromLegacySpoolKey(spoolRef: string): string {
  return spoolRef.split("/")[SPOOL_KEY_PREFIX.split("/").length] ?? "";
}

/**
 * Refuses a v1 key whose tenant segment is not the tenant the command was
 * authenticated as.
 *
 * The v1 format is the one place a location still travels inside the command,
 * so it is the one place a tampered reference could still steer a read. Pinning
 * it to the command's own tenant keeps the compatibility window from reopening
 * the hole the v2 format closes.
 */
function assertLegacySpoolKeyBelongsTo(
  spoolRef: string,
  projectId: string,
): void {
  const keyProjectId = projectIdFromLegacySpoolKey(spoolRef);
  if (keyProjectId !== projectId) {
    throw new Error(
      `Refusing to read spool object: reference names tenant "${keyProjectId}" but the command is authenticated as "${projectId}".`,
    );
  }
}

/**
 * Provides transient spool operations (ADR-022 write path) and event_log
 * read operations (ADR-022 read path).
 *
 * Spool: a per-span transient object used to carry over-threshold command
 * payloads from the edge to the command worker. Eagerly deleted after the
 * event_log INSERT succeeds; 3-day lifecycle policy as safety net for orphans
 * (3 days covers weekend incidents that need catch-up time).
 *
 * Spool writes go through the shared `stored-objects` layer, so the spool
 * lands wherever the project's storage destination points — S3, Azure Blob, or
 * the local filesystem. It used to speak the AWS SDK directly, which made it
 * the one byte-writing surface that silently ignored a deployment's Azure
 * configuration (langwatch/langwatch-saas#800).
 *
 * Event log: the durable source of truth. `getFromEventLog` performs a
 * SELECT on `event_log` keyed by (TenantId, AggregateType, AggregateId,
 * EventId). TenantId is the FIRST predicate, structurally blocking
 * cross-tenant reads. ADR-022.
 */
export class BlobStore {
  /**
   * @param resolveS3Client - Resolver for per-org S3 client + bucket. Used ONLY
   *   to read back v1 spool refs written before this deployment; every new
   *   write goes through `objectStoreFor`.
   * @param resolveClickHouseClient - Optional per-tenant ClickHouseClient resolver for ADR-022
   *   event_log reads. When provided, `getFromEventLog` resolves the correct client for the
   *   given tenantId (supporting multi-cluster tenants). When absent, `getFromEventLog` throws
   *   "ClickHouseClient not configured".
   * @param spoolStorage - The destination-agnostic object store the spool
   *   writes to, injected so this class stays free of env coupling and the
   *   tests exercise it without infrastructure. When absent, spool writes
   *   throw — `maybeSpool` is fail-open, so ingestion degrades to inline
   *   payloads rather than breaking.
   * @param logger - Optional; used only to surface a refused cross-tenant
   *   delete, which `deleteSpool`'s best-effort swallow would otherwise hide.
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
   * Re-derives the spool object's URI from server-trusted inputs. Never reads a
   * location out of the command.
   */
  private async mintSpoolUri({
    projectId,
    traceId,
    spanId,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
  }): Promise<{ uri: string; objectStore: SpoolObjectStore }> {
    if (!this.spoolStorage) {
      throw new Error(
        "BlobStore has no spool storage configured — cannot resolve the trace spool destination.",
      );
    }
    const destination = await this.spoolStorage.resolveDestination(projectId);

    // The spool is the one stored-objects consumer that depends on something
    // OUTSIDE the object store to stay bounded: it deletes eagerly after the
    // event_log INSERT, and leans on a lifecycle rule to reap whatever a crash
    // between those two steps leaves behind. A filesystem has no such rule, so
    // on this destination an orphan is permanent and the volume is what fills.
    //
    // Refusing here is not a regression. Before this consumer moved onto the
    // shared layer it built an S3 client, and on a local install that resolved
    // to the hardcoded "langwatch" bucket, which does not exist — so the PUT
    // failed and `maybeSpool` fell open to an inline payload every time. This
    // makes that same outcome explicit and loud instead of incidental.
    if (destination.kind === "file") {
      throw new SpoolDestinationUnsupportedError(
        "The trace spool has no local-filesystem path: orphaned spool objects are reaped by a " +
          "bucket/container lifecycle rule, which a filesystem cannot express, so a crash between " +
          "the write and its delete would leave the object forever. Ingestion continues with the " +
          "full payload inline. Configure S3 or Azure Blob storage to get oversize protection.",
      );
    }

    // Same rule, applied consistently. Azure CAN express the lifecycle policy
    // the orphan bound depends on — but nothing here can confirm it exists.
    // The policy is a MANAGEMENT-plane resource
    // (Microsoft.Storage/storageAccounts/managementPolicies); this deployment
    // holds a data-plane key only, so reading it back would mean asking every
    // operator for ARM credentials and a subscription id the feature otherwise
    // has no use for. Refusing to check is not the same as refusing to care:
    // the operator asserts it at deploy time, in the same config that turns the
    // spool on, and the default is off. An Azure install that enables the flag
    // without provisioning retention therefore degrades to inline payloads
    // rather than accumulating customer trace data nothing will ever reap.
    if (
      destination.kind === "azure" &&
      !this.spoolStorage.azureRetentionConfirmed
    ) {
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

    return {
      uri: mintUriForDestination({
        destination,
        objectPath: buildSpoolObjectPath({ projectId, traceId, spanId }),
      }),
      objectStore: this.spoolStorage.objectStoreFor(projectId),
    };
  }

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
   * Fetches the full span body from the transient spool object.
   * Called by the command worker when a command carries a `spoolRef`.
   *
   * The object's location is re-derived from `projectId` / `traceId` / `spanId`
   * — all read from the command itself, which the queue authenticated — rather
   * than from `spoolRef`. A tampered reference therefore cannot redirect this
   * read at another tenant's bytes; the worst it can do is name a v1 format and
   * miss.
   *
   * NOT fail-open, deliberately: the edge cleared `span.attributes` before
   * spooling, so returning nothing here would write an empty span to
   * `event_log` — permanent, silent loss in the sole source of truth. Throwing
   * lets the command retry.
   *
   * @returns The raw body buffer as stored by `putSpool`.
   * @throws {Error} If the object is absent, unreadable, or exceeds
   *   {@link MAX_SPOOL_BYTES}.
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
    });
    return streamToBuffer(await objectStore.get(uri), MAX_SPOOL_BYTES);
  }

  /**
   * v1 read path: the reference IS the S3 key. Retained for one release so
   * commands queued across the deploy still resolve. See {@link isLegacySpoolRef}.
   */
  private async getLegacySpool(
    spoolRef: string,
    projectId: string,
  ): Promise<Buffer> {
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
   * Writes the transient spool object for an over-threshold command payload and
   * returns the reference the command will carry.
   *
   * The object lands at whichever backend the project's storage destination
   * names. Object path: `trace-blobs/spool/{projectId}/{traceId}/{spanId}` —
   * transient, eagerly deleted after the event_log INSERT succeeds. The
   * bucket/container MUST have a 3-day lifecycle rule on the
   * `trace-blobs/spool/` prefix as the safety net for orphans (3 days covers
   * weekend incidents that need catch-up time).
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
    });
    await objectStore.put(uri, body, "application/octet-stream");
    return SPOOL_REF_V2;
  }

  /**
   * Best-effort deletion of the transient spool object.
   * Called after the event_log INSERT succeeds. Errors are swallowed — the
   * 3-day lifecycle rule is the safety net for orphans. Returns void in all cases.
   *
   * @throws Never — all errors are swallowed internally.
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
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: s3Bucket, Key: spoolRef }),
        );
        return;
      }
      const { uri, objectStore } = await this.mintSpoolUri({
        projectId,
        traceId,
        spanId,
      });
      await objectStore.delete(uri);
    } catch {
      // Best-effort — swallow all errors; lifecycle policy is the safety net.
    }
  }
}

import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Reference to a trace field value offloaded to object storage. Stored inline
 * (alongside a bounded preview) in place of an over-threshold span attribute
 * value, so the queue job / fold cache / ClickHouse rows stay small. The full
 * value is fetched from S3 only on the rare read that needs it (eval, "open
 * full"). See ADR-021 and issue #4215.
 *
 * Key shape: `trace-blobs/{projectId}/{traceId}/{spanId}` — one object per
 * span containing all over-threshold fields as a JSON manifest. `field` is
 * the attrKey selector within that manifest. Per-span (not per-trace) so
 * each OTLP ingest is one atomic PUT with no contention. ADR-021 / #4215.
 */
export interface TraceBlobRef {
  /** Positional, project-scoped key inside the org-resolved bucket (span-level). */
  key: string;
  /** The attribute key within the manifest's `fields` map. */
  field: string;
  /** UTF-8 byte length of THIS field's value. */
  size: number;
  /** SHA-256 of THIS field's value bytes — integrity check on read. */
  sha256: string;
  encoding: "utf-8";
}

/** Wire format of the per-span blob manifest stored in S3. */
interface BlobManifest {
  version: 1;
  encoding: "utf-8";
  fields: Record<string, string>;
}

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
}

/** Resolves the per-organization S3 client + bucket for a project. */
export type S3ClientResolver = (
  projectId: string,
) => Promise<S3ClientResolution>;

/**
 * Thrown by `BlobStore.get` (event_log backend) when the requested row is not found or
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

export class BlobIntegrityError extends Error {
  constructor(
    readonly key: string,
    readonly field: string,
    readonly expectedSha256: string,
    readonly actualSha256: string,
  ) {
    super(
      `Blob integrity check failed for ${key}#${field}: expected ${expectedSha256}, got ${actualSha256}`,
    );
    this.name = "BlobIntegrityError";
  }
}

/**
 * Thrown by `BlobStore.get` when the requested blob key does not belong to the
 * supplied `projectId`. In shared-bucket deployments a forged blob-ref must not
 * allow cross-project data access.
 */
export class UnauthorizedBlobAccessError extends Error {
  constructor(readonly key: string, readonly projectId: string) {
    super(
      `Blob key ${key} does not belong to project ${projectId}`,
    );
    this.name = "UnauthorizedBlobAccessError";
  }
}

/**
 * Thrown by `BlobStore.get` when the manifest was fetched successfully but
 * the requested `field` is not present. Indicates a corrupted manifest or a
 * stale ref pointing at an object that was overwritten.
 */
export class BlobFieldNotFoundError extends Error {
  constructor(readonly key: string, readonly field: string) {
    super(`Field "${field}" not found in blob manifest at key ${key}`);
    this.name = "BlobFieldNotFoundError";
  }
}

/**
 * Stores large trace field values in object storage, ONE object per span
 * (manifest-shaped). All over-threshold fields for a span are batched into a
 * single JSON manifest and written with one PutObjectCommand, eliminating the
 * 3–5× per-field PUTs of the previous per-field shape.
 *
 * Key shape: `trace-blobs/{projectId}/{traceId}/{spanId}` — positional
 * (not content-hashed: trivial prefix-delete GC). The org bucket is resolved via
 * the injected `S3ClientResolver`; in per-org BYOC deployments each org has its
 * own bucket and cross-org access is gated at the bucket boundary. In shared-bucket
 * deployments (no BYOC configured), isolation is **API-enforced**: callers MUST
 * pass their authenticated `projectId`, which is encoded into the key prefix.
 *
 * Read coalescing: `get` accepts an optional manifest cache (Map<key, manifest>)
 * so the caller can pass the same cache across multiple `get` calls for the same
 * span, ensuring the manifest is fetched only once. ADR-021 / #4215.
 */
export class BlobStore {
  /**
   * @param resolveS3Client - Resolver for per-org S3 client + bucket.
   * @param clickHouseClient - Optional ClickHouseClient for ADR-022 event_log reads.
   *   When provided, `getFromEventLog` uses it to SELECT from event_log.
   *   When absent, `getFromEventLog` throws "ClickHouseClient not configured".
   */
  constructor(
    private readonly resolveS3Client: S3ClientResolver,
    private readonly clickHouseClient?: ClickHouseClient,
  ) {}

  static blobKey({
    projectId,
    traceId,
    spanId,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
  }): string {
    for (const part of [projectId, traceId, spanId]) {
      if (part.includes("..")) {
        throw new Error(
          `Invalid blob key component (path traversal): ${part}`,
        );
      }
    }
    return `trace-blobs/${projectId}/${traceId}/${spanId}`;
  }

  /**
   * Writes all over-threshold fields for one span as a single manifest object.
   * Returns a per-field map of TraceBlobRef (one per entry in `fields`).
   *
   * @param fields - Record mapping attrKey → full string value for every
   *   field that needs to be offloaded for this span.
   */
  async put({
    projectId,
    traceId,
    spanId,
    fields,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    fields: Record<string, string>;
  }): Promise<Record<string, TraceBlobRef>> {
    const key = BlobStore.blobKey({ projectId, traceId, spanId });
    const manifest: BlobManifest = { version: 1, encoding: "utf-8", fields };
    const body = Buffer.from(JSON.stringify(manifest), "utf-8");

    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
      }),
    );

    // Build per-field refs — sha256 is over the field value bytes, not the manifest.
    const refs: Record<string, TraceBlobRef> = {};
    for (const [attrKey, value] of Object.entries(fields)) {
      const fieldBytes = Buffer.from(value, "utf-8");
      const sha256 = createHash("sha256").update(fieldBytes).digest("hex");
      refs[attrKey] = {
        key,
        field: attrKey,
        size: fieldBytes.byteLength,
        sha256,
        encoding: "utf-8",
      };
    }
    return refs;
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
   * @throws {Error} When EventPayload JSON is corrupt.
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
    if (!this.clickHouseClient) {
      throw new Error(
        "ClickHouseClient not configured — cannot read from event_log (ADR-022)",
      );
    }

    // TenantId MUST be the first predicate in the WHERE clause (ADR-022 cross-tenant denial).
    const result = await this.clickHouseClient.query({
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

    const response = await result.json<{ EventPayload: string }>();
    const rows = response.data;

    if (!rows || rows.length === 0) {
      throw new BlobNotFoundError(eventId, field, tenantId);
    }

    const row = rows[0]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.EventPayload);
    } catch (e) {
      throw new Error(
        `Failed to parse EventPayload for eventId=${eventId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Extract span attribute by field name from the parsed EventPayload.
    // ADR-022: EventPayload contains the full event as stored by the command worker.
    const spanAttributes = (
      parsed as {
        data?: {
          span?: { attributes?: Array<{ key: string; value: { stringValue?: string } }> };
        };
      }
    )?.data?.span?.attributes;

    if (!Array.isArray(spanAttributes)) {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    const attr = spanAttributes.find(
      (a: { key: string }) => a.key === field,
    );

    if (!attr || typeof (attr as { value?: { stringValue?: string } }).value?.stringValue !== "string") {
      throw new BlobFieldNotFoundError(eventId, field);
    }

    return (attr as { value: { stringValue: string } }).value.stringValue;
  }

  /**
   * Fetches the manifest for `ref.key` and returns the value of `ref.field`.
   * Verifies per-field sha256 integrity. Accepts an optional `manifestCache`
   * so multiple gets on the same span share one S3 fetch.
   */
  async get({
    projectId,
    ref,
    manifestCache,
  }: {
    projectId: string;
    ref: TraceBlobRef;
    /** Optional cross-field cache keyed by manifest key. */
    manifestCache?: Map<string, BlobManifest>;
  }): Promise<string> {
    // Defense-in-depth: reject refs that don't belong to this project before
    // even resolving the S3 client. Prevents cross-project data access in
    // shared-bucket deployments where a forged blob-ref could fetch another
    // project's blob. CR-1 (#4215).
    if (!ref.key.startsWith(`trace-blobs/${projectId}/`)) {
      throw new UnauthorizedBlobAccessError(ref.key, projectId);
    }

    let manifest: BlobManifest;

    if (manifestCache?.has(ref.key)) {
      manifest = manifestCache.get(ref.key)!;
    } else {
      const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
      const { Body } = await s3Client.send(
        new GetObjectCommand({ Bucket: s3Bucket, Key: ref.key }),
      );
      const raw = (await Body?.transformToString("utf-8")) ?? "";
      manifest = JSON.parse(raw) as BlobManifest;
      manifestCache?.set(ref.key, manifest);
    }

    if (!(ref.field in manifest.fields)) {
      throw new BlobFieldNotFoundError(ref.key, ref.field);
    }

    const value = manifest.fields[ref.field]!;
    const actual = createHash("sha256")
      .update(Buffer.from(value, "utf-8"))
      .digest("hex");
    if (actual !== ref.sha256) {
      throw new BlobIntegrityError(ref.key, ref.field, ref.sha256, actual);
    }
    return value;
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
   * eagerly DELETEd after event_log INSERT succeeds. Bucket MUST have a 24h
   * lifecycle policy as a safety net for orphans.
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
   * Called after event_log INSERT succeeds. Errors are swallowed — the 24h lifecycle
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

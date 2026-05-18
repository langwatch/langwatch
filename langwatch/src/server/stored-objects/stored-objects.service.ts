/**
 * StoredObjectsService — business logic layer for stored objects.
 *
 * Orchestrates content-addressed storage: deduplication via SHA-256 probe,
 * byte I/O via StorageRegistry, and row persistence via StoredObjectsRepository.
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { env } from "~/env.mjs";
import {
  getStoredObjectDedupHitCounter,
  getStoredObjectExtractCounter,
  getStoredObjectSizeBytesHistogram,
  getStoredObjectWriteFailureCounter,
  storedObjectReadFailureCounter,
} from "~/server/metrics";
import { createLogger } from "~/utils/logger/server";
import { getS3ConfigForProject } from "~/server/dataplane-s3";
import { ObjectNotFoundError } from "./errors";
import type { StoredObject } from "./stored-object";
import type { StoredObjectsRepository } from "./stored-objects.repository";
import type { StorageRegistry } from "./storage-registry";
import { mintFileUri, mintS3Uri } from "./uri";

const tracer = getLangWatchTracer("langwatch.stored-objects.service");
const logger = createLogger("langwatch:stored-objects:service");

/**
 * Computes a deterministic UUID v5 from the combination of project_id and sha256.
 *
 * The `uuid` package is not present in this repo, so we derive the same result
 * manually:
 *  1. Hash `${projectId}:${sha256}` with SHA-1 (20 bytes).
 *  2. Set version bits (nibble at byte[6] high) to 0101 (v5).
 *  3. Set variant bits (byte[8] high two bits) to 10.
 *  4. Format the 16 bytes as a standard UUID string.
 *
 * The remaining 4 bytes of SHA-1 (bytes 16-19) are discarded — this matches
 * the RFC 4122 UUID v5 construction which uses a fixed 128-bit namespace UUID
 * combined with a hash but takes only 16 bytes total.
 *
 * Same inputs ALWAYS produce the same output, so concurrent pods calling this
 * function for the same (projectId, sha256) pair will write the same id.
 */
function deriveStoredObjectId({
  projectId,
  sha256,
}: {
  projectId: string;
  sha256: string;
}): string {
  const hash = createHash("sha1")
    .update(`${projectId}:${sha256}`)
    .digest();

  // Mutate the bytes in place per RFC 4122 §4.3 (Name-Based UUIDs / v5):
  //  - Byte 6 high nibble = 0101 (version = 5)
  //  - Byte 8 high two bits = 10 (variant = RFC 4122)
  // No `as number` cast needed — bitwise ops on Uint8Array elements
  // return numbers; the assignment back into the buffer is well-typed.
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;

  const hex = hash.toString("hex", 0, 16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * A function that returns the storage URI for a new object given a project id
 * and SHA-256 content hash. Injected into `StoredObjectsService` so tests can
 * supply a per-call stub without module-level mocking.
 */
export type MintStorageUri = (args: { projectId: string; sha256: string }) => Promise<string>;

/**
 * Returns the storage URI for a new object, resolving the bucket per-project.
 *
 * Resolution precedence (matches createS3Client in src/server/storage.ts):
 *  1. BYOC: per-project private dataplane bucket from `getS3ConfigForProject`.
 *  2. Global: `env.S3_BUCKET_NAME`.
 *  3. Fallback: local filesystem at `env.LANGWATCH_LOCAL_STORAGE_PATH`.
 *
 * Without the per-project resolution, a BYOC tenant's persisted `storage_uri`
 * column would encode the wrong (global) bucket while the actual write goes
 * to the private bucket. That mismatch breaks reads and tenant isolation,
 * since `S3Driver` parses the URI to determine the bucket on GET.
 */
async function defaultMintStorageUri({
  projectId,
  sha256,
}: {
  projectId: string;
  sha256: string;
}): Promise<string> {
  const privateConfig = await getS3ConfigForProject(projectId);
  const s3Bucket =
    privateConfig?.bucket ??
    (env.S3_BUCKET_NAME && env.S3_BUCKET_NAME.trim() !== ""
      ? env.S3_BUCKET_NAME
      : undefined);

  if (s3Bucket) {
    return mintS3Uri({ bucket: s3Bucket, projectId, sha256 });
  }
  const root =
    env.LANGWATCH_LOCAL_STORAGE_PATH ?? "/var/lib/langwatch/objects";
  return mintFileUri({ root, projectId, sha256 });
}

/**
 * Service for storing and retrieving externalized byte content.
 *
 * Inject `repository`, `registry`, and optionally `mintStorageUri` for
 * testing. The production singleton uses `defaultMintStorageUri` as the
 * default so callers that omit the third arg are unaffected.
 */
export class StoredObjectsService {
  constructor(
    private readonly repository: StoredObjectsRepository,
    private readonly registry: StorageRegistry,
    private readonly mintStorageUri: MintStorageUri = defaultMintStorageUri,
  ) {}

  /**
   * Stores byte content for a project, deduplicating by content hash.
   *
   * Steps:
   *  1. Compute SHA-256 of bytes.
   *  2. Derive deterministic id from (projectId, sha256).
   *  3. Probe repository for an existing row with the same sha256.
   *  4. On hit: return existing id without writing anything.
   *  5. On miss: PUT bytes, INSERT row, return new id.
   *
   * If the PUT fails the CH row is NOT inserted and the error is rethrown.
   *
   * Metrics:
   *  - `stored_object_extract_total{purpose}` on every call.
   *  - `stored_object_dedup_hit_total{purpose}` on dedup hit.
   *  - `stored_object_write_failures_total{purpose}` on PUT failure.
   *  - `stored_object_size_bytes{purpose}` histogram on every call.
   */
  async storeFromBytes({
    projectId,
    purpose,
    ownerKind,
    ownerId,
    mediaType,
    bytes,
  }: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }> {
    return tracer.withActiveSpan(
      "StoredObjectsService.storeFromBytes",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "stored_object.purpose": purpose,
          "stored_object.owner_kind": ownerKind,
          "stored_object.media_type": mediaType,
          "stored_object.size_bytes": bytes.length,
        },
      },
      async (span) => {
        getStoredObjectExtractCounter(purpose).inc();
        getStoredObjectSizeBytesHistogram(purpose).observe(bytes.length);

        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const id = deriveStoredObjectId({ projectId, sha256 });

        span.setAttribute("stored_object.id", id);
        span.setAttribute("stored_object.sha256", sha256);

        // Dedup probe: if content already present, skip PUT + INSERT
        const existing = await this.repository.findBySha256({ projectId, sha256 });
        if (existing) {
          getStoredObjectDedupHitCounter(purpose).inc();
          span.setAttribute("stored_object.dedup_hit", true);
          return { id: existing.id, mediaType, isDuplicate: true };
        }

        const storageUri = await this.mintStorageUri({ projectId, sha256 });

        // PUT first: if storage rejects, never write the CH row
        try {
          await this.registry.put(storageUri, bytes, mediaType);
        } catch (error) {
          getStoredObjectWriteFailureCounter(purpose).inc();
          logger.error(
            { projectId, id, sha256, storageUri, error },
            "Failed to PUT stored object bytes",
          );
          throw error;
        }

        const now = new Date();
        const row: StoredObject = {
          id,
          project_id: projectId,
          purpose,
          owner_kind: ownerKind,
          owner_id: ownerId,
          media_type: mediaType,
          size_bytes: bytes.length,
          sha256,
          storage_uri: storageUri,
          created_at: now,
          inserted_at: now,
        };

        // Compensating cleanup: if the CH insert fails after a successful
        // PUT, the bytes would be orphaned in storage (no row points at
        // them). Best-effort delete the just-written object so we don't
        // leak storage. The original insert error is what the caller sees.
        try {
          await this.repository.insert({ projectId, row });
        } catch (insertError) {
          getStoredObjectWriteFailureCounter(purpose).inc();
          try {
            await this.registry.delete(storageUri);
          } catch (deleteError) {
            logger.warn(
              { projectId, id, storageUri, deleteError, insertError },
              "compensating delete failed; bytes may be orphaned",
            );
          }
          throw insertError;
        }

        span.setAttribute("stored_object.dedup_hit", false);
        return { id, mediaType, isDuplicate: false };
      },
    );
  }

  /**
   * Retrieves a stored object row and a readable stream of its bytes.
   *
   * Returns:
   *  - `{ row, stream }` when the row exists and storage has the bytes.
   *  - `{ row, status: "missing" }` when the row exists but storage 404s.
   *  - `null` when the row does not exist (caller maps to 404).
   *
   * On any non-404 storage error the error is rethrown (caller maps to 502).
   *
   * Metrics:
   *  - `stored_object_read_failures_total` on non-404 storage errors.
   */
  async getById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<
    | { row: StoredObject; stream: Readable }
    | { row: StoredObject; status: "missing" }
    | null
  > {
    return tracer.withActiveSpan(
      "StoredObjectsService.getById",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "stored_object.id": id,
        },
      },
      async (span) => {
        const row = await this.repository.findById({ projectId, id });

        span.setAttribute("result.found", row !== null);

        if (!row) {
          return null;
        }

        try {
          const stream = await this.registry.get(row.storage_uri);
          return { row, stream };
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            span.setAttribute("result.storage_missing", true);
            return { row, status: "missing" as const };
          }
          storedObjectReadFailureCounter.inc();
          logger.error(
            { projectId, id, storageUri: row.storage_uri, error },
            "Failed to GET stored object bytes",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Cascade-deletes every stored object owned by a project: deletes the
   * bytes from the storage backend first, then deletes the stored_objects
   * rows from ClickHouse.
   *
   * Bytes-before-rows ordering is intentional. If we deleted rows first and
   * then crashed mid-cascade, the bytes would orphan in S3/disk with no row
   * pointing at them — irrecoverably (we no longer know which keys to
   * delete). Bytes-first means a crash leaves rows that point at missing
   * bytes; GET /api/files/:id returns 404-missing for those, which is the
   * graceful degradation we already handle on the read path.
   *
   * Each individual byte-delete is best-effort: a single storage failure
   * does not halt the cascade. The error is logged and counted so the
   * operator can sweep up orphans later. The CH delete only runs after
   * all bytes have been attempted.
   */
  async cascadeDeleteProject({ projectId }: { projectId: string }): Promise<void> {
    return tracer.withActiveSpan(
      "StoredObjectsService.cascadeDeleteProject",
      { kind: SpanKind.INTERNAL, attributes: { "tenant.id": projectId } },
      async (span) => {
        const rows = await this.repository.findAllByProject({ projectId });
        span.setAttribute("stored_objects.count", rows.length);

        if (rows.length === 0) {
          return;
        }

        let bytesDeleted = 0;
        let byteDeleteFailures = 0;
        for (const row of rows) {
          try {
            await this.registry.delete(row.storage_uri);
            bytesDeleted++;
          } catch (error) {
            byteDeleteFailures++;
            logger.warn(
              { projectId, id: row.id, storageUri: row.storage_uri, error },
              "cascadeDeleteProject: failed to delete bytes; row will still be removed",
            );
          }
        }
        span.setAttribute("stored_objects.bytes_deleted", bytesDeleted);
        span.setAttribute("stored_objects.byte_delete_failures", byteDeleteFailures);

        await this.repository.deleteByProject({ projectId });
        logger.info(
          { projectId, rowsCount: rows.length, bytesDeleted, byteDeleteFailures },
          "cascadeDeleteProject completed",
        );
      },
    );
  }

  /**
   * Cascade-deletes every stored object for a single (project, owner) tuple.
   *
   * Used when the owning trace, span, or scenario run is deleted but the
   * project itself remains. Same bytes-before-rows ordering as
   * `cascadeDeleteProject` — see that method's docstring for the rationale.
   */
  async cascadeDeleteOwner({
    projectId,
    ownerKind,
    ownerId,
  }: {
    projectId: string;
    ownerKind: string;
    ownerId: string;
  }): Promise<void> {
    return tracer.withActiveSpan(
      "StoredObjectsService.cascadeDeleteOwner",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "stored_object.owner_kind": ownerKind,
          "stored_object.owner_id": ownerId,
        },
      },
      async (span) => {
        const rows = await this.repository.findAllByProject({
          projectId,
          ownerKind,
          ownerId,
        });
        span.setAttribute("stored_objects.count", rows.length);

        if (rows.length === 0) {
          return;
        }

        let bytesDeleted = 0;
        let byteDeleteFailures = 0;
        for (const row of rows) {
          try {
            await this.registry.delete(row.storage_uri);
            bytesDeleted++;
          } catch (error) {
            byteDeleteFailures++;
            logger.warn(
              { projectId, ownerKind, ownerId, id: row.id, storageUri: row.storage_uri, error },
              "cascadeDeleteOwner: failed to delete bytes; row will still be removed",
            );
          }
        }
        span.setAttribute("stored_objects.bytes_deleted", bytesDeleted);
        span.setAttribute("stored_objects.byte_delete_failures", byteDeleteFailures);

        await this.repository.deleteByProject({ projectId, ownerKind, ownerId });
        logger.info(
          { projectId, ownerKind, ownerId, rowsCount: rows.length, bytesDeleted, byteDeleteFailures },
          "cascadeDeleteOwner completed",
        );
      },
    );
  }
}

// ============================================================================
// Module-level helpers — exported for re-use
// ============================================================================

export { deriveStoredObjectId };

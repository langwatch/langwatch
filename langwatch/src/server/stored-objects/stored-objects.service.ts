/**
 * StoredObjectsService — business logic layer for stored objects.
 *
 * Orchestrates content-addressed storage: deduplication via SHA-256 probe,
 * byte I/O via StorageRegistry, and row persistence via StoredObjectsRepository.
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { SpanKind } from "@opentelemetry/api";
import { Instance, Ksuid } from "@langwatch/ksuid";
import { getLangWatchTracer } from "langwatch";
import {
  getStoredObjectDedupHitCounter,
  getStoredObjectExtractCounter,
  getStoredObjectSizeBytesHistogram,
  getStoredObjectWriteFailureCounter,
  storedObjectReadFailureCounter,
} from "~/server/metrics";
import { createLogger } from "~/utils/logger/server";
import { ObjectNotFoundError } from "./errors";
import {
  redactStorageUri,
  resolveProjectStorageDestination,
} from "./project-storage-destination";
import type { StoredObject } from "./stored-object";
import type { StoredObjectsRepository } from "./stored-objects.repository";
import type { StorageRegistry } from "./storage-registry";
import { mintFileUri, mintS3Uri } from "./uri";

const tracer = getLangWatchTracer("langwatch.stored-objects.service");
const logger = createLogger("langwatch:stored-objects:service");

/**
 * Derives a deterministic content-addressed id from (projectId, sha256).
 *
 * Uses @langwatch/ksuid with a fixed timestamp (0) and sequence (0) so the
 * id is purely a function of the input bytes — no randomness, no system clock.
 * The 8-byte Instance identifier is the first 8 bytes of sha1(projectId:sha256),
 * making same inputs always produce the same output. Concurrent pods calling
 * this function for the same (projectId, sha256) pair will write the same id,
 * collapsing onto one ClickHouse row in the ReplacingMergeTree.
 */
function deriveStoredObjectId({
  projectId,
  sha256,
}: {
  projectId: string;
  sha256: string;
}): string {
  const hash = createHash("sha1").update(`${projectId}:${sha256}`).digest();
  const identifier = hash.subarray(0, 8) as unknown as Uint8Array;
  const instance = new Instance(Instance.schemes.RANDOM, identifier);
  return new Ksuid("prod", "so", 0, instance, 0).toString();
}

/**
 * A function that returns the storage URI for a new object given a project id
 * and SHA-256 content hash. Injected into `StoredObjectsService` so tests can
 * supply a per-call stub without module-level mocking.
 */
export type MintStorageUri = (args: { projectId: string; sha256: string }) => Promise<string>;

/**
 * Returns the storage URI for a new object, delegating destination
 * resolution to the shared `resolveProjectStorageDestination` so that
 * this service module does not encode the precedence rules itself.
 *
 * If `resolveProjectStorageDestination` throws (e.g. a transient DB
 * error while reading BYOC config), the error propagates — falling
 * back silently to the global bucket on a transient error would risk
 * spilling a BYOC tenant's bytes into the wrong account.
 */
async function defaultMintStorageUri({
  projectId,
  sha256,
}: {
  projectId: string;
  sha256: string;
}): Promise<string> {
  const destination = await resolveProjectStorageDestination(projectId);
  if (destination.kind === "s3") {
    return mintS3Uri({ bucket: destination.bucket, projectId, sha256 });
  }
  return mintFileUri({ root: destination.root, projectId, sha256 });
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

        // Dedup probe: if content already present, skip PUT + INSERT.
        // Lookup by id (not sha256) because:
        //   1. id is derived deterministically from (projectId, sha256) right
        //      above, so it's already known here — no extra computation.
        //   2. The stored_objects table's `ORDER BY (project_id, id)` makes
        //      this a primary-key seek with partition pruning; a sha256
        //      lookup would scan every weekly partition incl. cold S3 because
        //      sha256 is not in the sort key.
        const existing = await this.repository.findById({ projectId, id });
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
            {
              projectId,
              id,
              sha256,
              // Redact bucket / account / install-path segments — for
              // BYOC tenants, the raw URI would carry their private
              // bucket name into shared log sinks.
              storageUri: redactStorageUri(storageUri),
              error,
            },
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
              {
                projectId,
                id,
                storageUri: redactStorageUri(storageUri),
                deleteError,
                insertError,
              },
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
   * Probes for existence without streaming the bytes.
   *
   * Returns the same tri-state as the HTTP HEAD route at `/api/files/:id`:
   *  - `{ status: "available", mediaType }` — row exists and storage has the bytes
   *  - `{ status: "missing", mediaType }`   — row exists but storage 404s
   *  - `{ status: "not_found" }`            — no row matches
   *
   * Used by the tRPC `storedObjects.headById` probe from the renderer to
   * distinguish "blob is gone" (graceful missing-badge) from "row never
   * existed" (404) without round-tripping the body.
   */
  async headById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<
    | { status: "available"; mediaType: string }
    | { status: "missing"; mediaType: string }
    | { status: "not_found" }
  > {
    const row = await this.repository.findById({ projectId, id });
    if (!row) return { status: "not_found" };
    const bytesPresent = await this.registry.exists(row.storage_uri);
    return bytesPresent
      ? { status: "available", mediaType: row.media_type }
      : { status: "missing", mediaType: row.media_type };
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
            {
              projectId,
              id,
              storageUri: redactStorageUri(row.storage_uri),
              error,
            },
            "Failed to GET stored object bytes",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Deletes all stored objects owned by a project: deletes the bytes from
   * the storage backend first, then deletes the stored_objects rows from
   * ClickHouse.
   *
   * Bytes-before-rows ordering is intentional. If we deleted rows first and
   * then crashed mid-cascade, the bytes would orphan in S3/disk with no row
   * pointing at them — irrecoverably (we no longer know which keys to
   * delete). Bytes-first means a crash leaves rows that point at missing
   * bytes; GET /api/files/:id returns 404-missing for those, which is the
   * graceful degradation we already handle on the read path.
   *
   * Each individual byte-delete is best-effort: a single storage failure
   * does not halt the cascade. Failed rows are NOT removed from ClickHouse
   * — they stay behind as retryable tombstones so a follow-up cascade
   * re-attempts the byte-delete using the same `storage_uri`. Dropping the
   * row along with a failed byte-delete would lose the address of the
   * orphaned bytes (Sergio review 2026-05-20).
   */
  async deleteOwnedBy({ projectId }: { projectId: string }): Promise<void> {
    return tracer.withActiveSpan(
      "StoredObjectsService.deleteOwnedBy",
      { kind: SpanKind.INTERNAL, attributes: { "tenant.id": projectId } },
      async (span) => {
        const rows = await this.repository.findAllByProject({ projectId });
        span.setAttribute("stored_objects.count", rows.length);

        if (rows.length === 0) {
          return;
        }

        const succeededIds: string[] = [];
        let bytesDeleted = 0;
        let byteDeleteFailures = 0;
        for (const row of rows) {
          try {
            await this.registry.delete(row.storage_uri);
            bytesDeleted++;
            succeededIds.push(row.id);
          } catch (error) {
            byteDeleteFailures++;
            logger.warn(
              {
                projectId,
                id: row.id,
                storageUri: redactStorageUri(row.storage_uri),
                error,
              },
              "deleteOwnedBy: failed to delete bytes; row retained as retryable tombstone",
            );
          }
        }
        span.setAttribute("stored_objects.bytes_deleted", bytesDeleted);
        span.setAttribute("stored_objects.byte_delete_failures", byteDeleteFailures);
        span.setAttribute("stored_objects.rows_retained_for_retry", byteDeleteFailures);

        // Only remove the rows whose bytes were successfully deleted.
        // Failed rows stay behind so the next cascade can retry the
        // byte-delete using the still-present storage_uri.
        if (succeededIds.length > 0) {
          await this.repository.deleteByIds({ projectId, ids: succeededIds });
        }
        logger.info(
          {
            projectId,
            rowsCount: rows.length,
            bytesDeleted,
            byteDeleteFailures,
            rowsDeleted: succeededIds.length,
            rowsRetainedForRetry: byteDeleteFailures,
          },
          "deleteOwnedBy completed",
        );
      },
    );
  }

}

// ============================================================================
// Module-level helpers — exported for re-use
// ============================================================================

export { deriveStoredObjectId };

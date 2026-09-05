/**
 * StoredObjectsService — business logic layer for stored objects.
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { Instance, Ksuid } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { redactStoredObjectStorageUri } from "@langwatch/stored-object-contract";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { StoredObjectStoragePort } from "../ports/stored-object-storage.port";
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";
import type { StoredObjectsTelemetryPort } from "../ports/stored-objects-telemetry.port";
import type { StoredObject } from "../rules/stored-object-row.rules";
import type { StoredObjectsRepository } from "../repositories/stored-objects.repository";

const tracer = getLangWatchTracer("langwatch.stored-objects.service");
const logger = createLogger("langwatch:stored-objects:service");

/**
 * Derives a deterministic content-addressed id from (projectId, sha256).
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

type RegistryResolver = StoredObjectStoragePort | ((projectId: string) => StoredObjectStoragePort);

/** What the process composes this service from. */
export type StoredObjectsServiceOptions = Readonly<{
  repository: StoredObjectsRepository;
  /**
   * The scheme dispatch a project's bytes are read and written through. A
   * function where the drivers are project-scoped, which is what a BYOC
   * tenant's own bucket and credentials require.
   */
  registry: RegistryResolver;
  /**
   * Where a NEW object goes, as the deployment's destination precedence resolves
   * it — BYOC bucket, then the selected backend, then the documented
   * single-replica filesystem fallback.
   */
  mintStorageUri: MintStorageUri;
  /** The five series this store publishes about its own work. */
  telemetry: StoredObjectsTelemetryPort;
}>;

/**
 * Service for storing and retrieving externalized byte content.
 */
export class StoredObjectsService {
  static create(options: StoredObjectsServiceOptions): StoredObjectsService {
    return new StoredObjectsService(options);
  }

  private constructor(private readonly options: StoredObjectsServiceOptions) {}

  private get repository(): StoredObjectsRepository {
    return this.options.repository;
  }

  private get telemetry(): StoredObjectsTelemetryPort {
    return this.options.telemetry;
  }

  private mintStorageUri(input: { projectId: string; sha256: string }): Promise<string> {
    return this.options.mintStorageUri(input);
  }

  private registryFor(projectId: string): StoredObjectStoragePort {
    const { registry } = this.options;

    return typeof registry === "function" ? registry(projectId) : registry;
  }

  /**
   * Stores byte content for a project, deduplicating by content hash.
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
        this.telemetry.recordExtract(purpose);
        this.telemetry.observeSizeBytes(purpose, bytes.length);

        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const id = deriveStoredObjectId({ projectId, sha256 });

        span.setAttribute("stored_object.id", id);
        span.setAttribute("stored_object.sha256", sha256);

        // Dedup probe: if content already present, skip PUT + INSERT. Lookup by id (not sha256)
        // because: 1. id is derived deterministically from (projectId, sha256) right above, so
        // it's already known here — no extra computation. 2. The stored_objects table's `ORDER BY
        // (project_id, id)` makes this a primary-key seek with partition pruning; a sha256 lookup
        // would scan every weekly partition incl. cold S3 because sha256 is not in the sort key.
        const existing = await this.repository.tryFindById({ projectId, id });
        if (existing) {
          this.telemetry.recordDedupHit(purpose);
          span.setAttribute("stored_object.dedup_hit", true);

          return { id: existing.id, mediaType, isDuplicate: true };
        }

        const storageUri = await this.mintStorageUri({ projectId, sha256 });
        const registry = this.registryFor(projectId);

        // PUT first: if storage rejects, never write the CH row
        try {
          await registry.put(storageUri, bytes, mediaType);
        } catch (error) {
          this.telemetry.recordWriteFailure(purpose);
          logger.error(
            {
              projectId,
              id,
              sha256,
              // Redact bucket / account / install-path segments — for
              // BYOC tenants, the raw URI would carry their private
              // bucket name into shared log sinks.
              storageUri: redactStoredObjectStorageUri(storageUri),
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
          this.telemetry.recordWriteFailure(purpose);
          try {
            await registry.delete(storageUri);
          } catch (deleteError) {
            logger.error(
              {
                projectId,
                id,
                storageUri: redactStoredObjectStorageUri(storageUri),
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
    const row = await this.repository.tryFindById({ projectId, id });
    if (!row) {
      return { status: "not_found" };
    }

    const bytesPresent = await this.registryFor(projectId).exists(row.storage_uri);

    return bytesPresent
      ? { status: "available", mediaType: row.media_type }
      : { status: "missing", mediaType: row.media_type };
  }

  /**
   * Retrieves a stored object row and a readable stream of its bytes.
   */
  async tryGetById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<
    { row: StoredObject; stream: Readable } | { row: StoredObject; status: "missing" } | null
  > {
    return tracer.withActiveSpan(
      "StoredObjectsService.tryGetById",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "stored_object.id": id,
        },
      },
      async (span) => {
        const row = await this.repository.tryFindById({ projectId, id });

        span.setAttribute("result.found", row !== null);

        if (!row) {
          return null;
        }

        try {
          const stream = await this.registryFor(projectId).get(row.storage_uri);

          return { row, stream };
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            span.setAttribute("result.storage_missing", true);

            return { row, status: "missing" as const };
          }

          this.telemetry.recordReadFailure();
          logger.error(
            {
              projectId,
              id,
              storageUri: redactStoredObjectStorageUri(row.storage_uri),
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
   * summed `size_bytes` of the project's live stored objects, optionally scoped to one `purpose` (e.g. "evaluation_inputs").
   * This is the durable-object side of a tenant's storage usage, alongside the ClickHouse row bytes.
   * Returns the storage-accounting byte ledger for a project (ADR-040): the
   */
  async getStorageUsageByProject({
    projectId,
    purpose,
  }: {
    projectId: string;
    purpose?: string;
  }): Promise<{ totalBytes: number; objectCount: number }> {
    return tracer.withActiveSpan(
      "StoredObjectsService.getStorageUsageByProject",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          ...(purpose ? { "stored_object.purpose": purpose } : {}),
        },
      },
      async () => this.repository.sumSizeBytesByProject({ projectId, purpose }),
    );
  }

  /**
   * Deletes all stored objects owned by a project: deletes the bytes from the
   * storage backend first, then deletes the stored_objects rows from ClickHouse.
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
        const registry = this.registryFor(projectId);
        for (const row of rows) {
          try {
            await registry.delete(row.storage_uri);
            bytesDeleted++;
            succeededIds.push(row.id);
          } catch (error) {
            byteDeleteFailures++;
            logger.warn(
              {
                projectId,
                id: row.id,
                storageUri: redactStoredObjectStorageUri(row.storage_uri),
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

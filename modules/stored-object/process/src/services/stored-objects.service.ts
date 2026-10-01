/**
 * StoredObjectsService — the read-only legacy ClickHouse index (ADR-158 §5): a row and
 * its bytes by id, and a probe. Nothing writes the index.
 */
import type { Readable } from "node:stream";

import { createLogger } from "@langwatch/observability";
import {
  redactStoredObjectStorageUri,
  ObjectNotFoundError,
  StoredObjectNotFoundError,
} from "@langwatch/stored-object-contract";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { StoredObjectsTelemetry } from "../app/stored-object.members.ts";
import type { StoredObjectStorageRepository } from "../repositories/stored-object-storage.repository.ts";
import type { StoredObjectsRepository } from "../repositories/stored-objects.repository.ts";
import type { StoredObject } from "../rules/stored-object-row.rules.ts";

const tracer = getLangWatchTracer("langwatch.stored-objects.service");
const logger = createLogger("langwatch:stored-objects:service");

type RegistryResolver =
  | StoredObjectStorageRepository
  | ((projectId: string) => StoredObjectStorageRepository);

/** What the process composes this service from. */
export type StoredObjectsServiceOptions = Readonly<{
  repository: StoredObjectsRepository;
  /**
   * The scheme dispatch a project's bytes are read through. A
   * function where the drivers are project-scoped, which is what a BYOC
   * tenant's own bucket and credentials require.
   */
  registry: RegistryResolver;
  /** Where a failed storage read is counted. */
  telemetry: StoredObjectsTelemetry;
}>;

/**
 * Reads stored objects from the legacy index.
 */
export class StoredObjectsService {
  static create(options: StoredObjectsServiceOptions): StoredObjectsService {
    return new StoredObjectsService(options);
  }

  private constructor(private readonly options: StoredObjectsServiceOptions) {}

  private get repository(): StoredObjectsRepository {
    return this.options.repository;
  }

  private get telemetry(): StoredObjectsTelemetry {
    return this.options.telemetry;
  }

  private registryFor(projectId: string): StoredObjectStorageRepository {
    const { registry } = this.options;

    return typeof registry === "function" ? registry(projectId) : registry;
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
    | { status: "available"; mediaType: string; purpose: string }
    | { status: "missing"; mediaType: string; purpose: string }
    | { status: "not_found" }
  > {
    const row = await this.repository.tryFindById({ projectId, id });
    if (!row) {
      return { status: "not_found" };
    }

    const bytesPresent = await this.registryFor(projectId).exists(row.storage_uri);

    const facts = { mediaType: row.media_type, purpose: row.purpose };
    return bytesPresent ? { status: "available", ...facts } : { status: "missing", ...facts };
  }

  /**
   * Retrieves a stored object row and a readable stream of its bytes.
   */
  /** Throws `StoredObjectNotFoundError` when the project holds no such row. */
  async getById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<{ row: StoredObject; stream: Readable } | { row: StoredObject; status: "missing" }> {
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
        const row = await this.repository.tryFindById({ projectId, id });

        span.setAttribute("result.found", row !== null);

        if (!row) {
          throw new StoredObjectNotFoundError();
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
}

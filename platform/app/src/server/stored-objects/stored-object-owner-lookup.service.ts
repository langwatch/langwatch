import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { StoredObjectOwnerClickHouseRepository } from "./repositories/stored-object-owner.clickhouse.repository";

const tracer = getLangWatchTracer("langwatch.stored-objects.cross-tenant-lookup");

export class StoredObjectOwnerLookupUnavailableError extends Error {
  readonly failedTargets: string[];

  constructor(failedTargets: string[]) {
    super(
      `cross-tenant owner lookup degraded: ${failedTargets.length} instance(s) failed (${failedTargets.join(", ")}); no hit on any healthy instance`,
    );
    this.name = "StoredObjectOwnerLookupUnavailableError";
    this.failedTargets = failedTargets;
  }
}

/**
 * The deliberately cross-tenant first step for historical `/api/files/:id`
 * URLs which do not carry a project id. Callers must switch to the ordinary
 * project-scoped stored-object service as soon as this resolves the owner.
 */
export class StoredObjectOwnerLookupService {
  static create(
    repository: StoredObjectOwnerClickHouseRepository,
  ): StoredObjectOwnerLookupService {
    return new StoredObjectOwnerLookupService(repository);
  }

  private constructor(
    private readonly repository: StoredObjectOwnerClickHouseRepository,
  ) {}

  resolve(input: { id: string }): Promise<{ projectId: string } | null> {
    return tracer.withActiveSpan(
      "StoredObjects.resolveStoredObjectOwner",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "stored_object.id": input.id,
        },
      },
      async (span) => {
        const { hit, failedTargets, instancesSearched } = await this.repository.findOwner(
          input.id,
        );

        span.setAttribute("clickhouse.instances_searched", instancesSearched);
        span.setAttribute("clickhouse.instances_failed", failedTargets.length);

        if (hit) {
          span.setAttribute("result.found", true);
          span.setAttribute("result.matched_instance", hit.target);
          return { projectId: hit.projectId };
        }

        span.setAttribute("result.found", false);
        if (failedTargets.length > 0) {
          span.setAttribute("result.degraded", true);
          throw new StoredObjectOwnerLookupUnavailableError(failedTargets);
        }

        return null;
      },
    );
  }
}

import {
  StoredObjectOwnerLookupUnavailableError,
  StoredObjectOwnerResolver,
} from "@langwatch/stored-object-contract";
import type { StoredObjectOwnerLookupSpan } from "../ports/stored-object-owner-lookup-telemetry.port";
import { StoredObjectOwnerLookupTelemetryPort } from "../ports/stored-object-owner-lookup-telemetry.port";
import {
  StoredObjectOwnerRepository,
  type StoredObjectOwnerLookupResult,
} from "../ports/stored-object-owner.repository";

/**
 * The legacy id-only file URL crosses tenant boundaries solely to identify an
 * owner. It is separate from ordinary project-scoped Stored Object access.
 */
export class StoredObjectOwnerLookupService extends StoredObjectOwnerResolver {
  static create(input: {
    repository: StoredObjectOwnerRepository;
    telemetry: StoredObjectOwnerLookupTelemetryPort;
  }): StoredObjectOwnerLookupService {
    return new StoredObjectOwnerLookupService(input.repository, input.telemetry);
  }

  private constructor(
    private readonly repository: StoredObjectOwnerRepository,
    private readonly telemetry: StoredObjectOwnerLookupTelemetryPort,
  ) {
    super();
  }

  resolve(input: { id: string }): Promise<{ projectId: string } | null> {
    return this.telemetry.withLookupSpan(input, async (span) => {
      const result = await this.repository.findOwner(input.id);
      this.recordResult(span, result);

      if (result.hit) {
        return { projectId: result.hit.projectId };
      }

      if (result.failedTargets.length > 0) {
        throw new StoredObjectOwnerLookupUnavailableError(result.failedTargets);
      }

      return null;
    });
  }

  private recordResult(
    span: StoredObjectOwnerLookupSpan,
    result: StoredObjectOwnerLookupResult,
  ): void {
    span.setAttribute("clickhouse.instances_searched", result.instancesSearched);
    span.setAttribute("clickhouse.instances_failed", result.failedTargets.length);
    span.setAttribute("result.found", result.hit !== null);
    if (result.hit) {
      span.setAttribute("result.matched_instance", result.hit.target);
    }

    if (!result.hit && result.failedTargets.length > 0) {
      span.setAttribute("result.degraded", true);
    }
  }
}

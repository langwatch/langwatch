import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RequestBoundKey } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { TraceIdsTooManyError } from "@langwatch/trace-contract";

/**
 * The tier-effective request bounds the trace reads clamp and refuse by. The
 * transport schemas cap at the registry's enterprise ceiling; this service
 * resolves the number the caller's plan answers through the entitlement peer.
 */
export class TraceReadBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }): TraceReadBoundsService {
    return new TraceReadBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
    }>,
  ) {}

  /** The page size a list read may use; a larger requested size clamps to it. */
  async clampPageSize(projectId: string, requested: number): Promise<number> {
    const max = await this.resolve(projectId, "tracesPageSizeMax");

    return Math.min(requested, max);
  }

  /**
   * Refuses an id array above the plan's bound. Silent drops are worse than
   * errors: a caller paging a large export must learn the bound on the first
   * oversized request, not discover missing rows later.
   */
  async assertIdsWithinBound(projectId: string, ids: readonly string[]): Promise<void> {
    const max = await this.resolve(projectId, "traceIdsMax");
    if (ids.length > max) {
      throw new TraceIdsTooManyError(max);
    }
  }

  private async resolve(projectId: string, key: RequestBoundKey): Promise<number> {
    const organizationId = await this.deps.projects.getOrganizationId(projectId);

    return this.deps.entitlement.requestBound({ key, organizationId });
  }
}

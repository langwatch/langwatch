import { DatasetBatchTooLargeError } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The tier-effective dataset batch bound: the transport schemas cap at the
 * registry's enterprise ceiling, this service resolves the number the
 * caller's plan answers through the entitlement peer.
 */
export class DatasetRequestBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }): DatasetRequestBoundsService {
    return new DatasetRequestBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      projects: Pick<ProjectApi, "getOrganizationId">;
    }>,
  ) {}

  /**
   * Refuses an entries or recordIds batch above the plan's bound. Silent
   * truncation is worse than a refusal: a write that drops rows teaches the
   * caller the wrong thing happened, a refusal teaches the bound.
   */
  async assertBatchSize(projectId: string, count: number): Promise<void> {
    const organizationId = await this.deps.projects.getOrganizationId(projectId);
    const maxEntries = await this.deps.entitlement.requestBound({
      key: "datasetBatchMax",
      organizationId,
    });

    if (count > maxEntries) {
      throw new DatasetBatchTooLargeError({ count, maxEntries });
    }
  }
}

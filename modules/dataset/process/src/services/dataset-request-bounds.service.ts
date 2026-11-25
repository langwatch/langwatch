import {
  DATASET_LIMIT_BOUND_KEYS,
  DatasetBatchTooLargeError,
  type DatasetLimits,
} from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";

type DatasetLimitName = keyof DatasetLimits;

const LIMIT_NAMES = Object.keys(DATASET_LIMIT_BOUND_KEYS) as DatasetLimitName[];

/**
 * The dataset bounds a project's organization answers: the transport schemas
 * and body caps declare the highest value any organization can hold, this
 * service resolves the organization's own number through the entitlement peer.
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

  /** One size limit, as the project's organization answers it. */
  async limit(projectId: string, name: DatasetLimitName): Promise<number> {
    const organizationId = await this.deps.projects.getOrganizationId(projectId);

    return this.deps.entitlement.requestBound({
      key: DATASET_LIMIT_BOUND_KEYS[name],
      organizationId,
    });
  }

  /** Every size limit, as the project's organization answers them. */
  async limits(projectId: string): Promise<DatasetLimits> {
    const organizationId = await this.deps.projects.getOrganizationId(projectId);
    const values = await Promise.all(
      LIMIT_NAMES.map((name) =>
        this.deps.entitlement.requestBound({
          key: DATASET_LIMIT_BOUND_KEYS[name],
          organizationId,
        }),
      ),
    );

    return Object.fromEntries(
      LIMIT_NAMES.map((name, index) => [name, values[index]!]),
    ) as DatasetLimits;
  }
}

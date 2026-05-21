import type { RetentionPolicyCache } from "../retentionPolicyCache";
import type {
  DataRetentionPolicyRepository,
  ProjectPolicyResult,
} from "./dataRetentionPolicy.repository";
import type { RetentionPolicy } from "../retentionPolicy.schema";

export class DataRetentionPolicyService {
  constructor(
    private readonly repository: DataRetentionPolicyRepository,
    private readonly retentionPolicyCache: RetentionPolicyCache,
  ) {}

  async getProjectPolicy({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectPolicyResult> {
    return this.repository.findProjectPolicy({ projectId });
  }

  async updateProjectPolicy({
    projectId,
    retentionPolicy,
  }: {
    projectId: string;
    retentionPolicy: RetentionPolicy | null;
  }): Promise<void> {
    await this.repository.updateProjectPolicy({ projectId, retentionPolicy });
    this.retentionPolicyCache.invalidate(projectId);
  }

  async updateOrgPolicy({
    organizationId,
    defaultRetentionPolicy,
  }: {
    organizationId: string;
    defaultRetentionPolicy: RetentionPolicy | null;
  }): Promise<void> {
    await this.repository.updateOrgPolicy({
      organizationId,
      defaultRetentionPolicy,
    });

    const projectIds = await this.repository.findProjectIdsByOrganization({
      organizationId,
    });
    for (const id of projectIds) {
      this.retentionPolicyCache.invalidate(id);
    }
  }
}

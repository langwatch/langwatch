import type { DataPrivacyScopeFacts } from "@langwatch/data-privacy-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { DataPrivacyProjectScopeRepository } from "../repositories/data-privacy-project-scope.repository.ts";

/**
 * The chain facts a resolution is built from, read from project's and organization's rows (R40).
 * No row is not found; an archived project resolves, as on main.
 * Spec: modules/data-privacy/specs/data-privacy-resolution-seam.feature
 */
export class DataPrivacyProjectScopeService {
  private constructor(private readonly repository: DataPrivacyProjectScopeRepository) {}

  static create({
    repository,
  }: {
    repository: DataPrivacyProjectScopeRepository;
  }): DataPrivacyProjectScopeService {
    return new DataPrivacyProjectScopeService(repository);
  }

  async getScopeFacts({ projectId }: { projectId: string }): Promise<DataPrivacyScopeFacts> {
    const scope = await this.repository.find({ projectId });
    if (!scope) throw new ProjectNotFoundError();

    return {
      organizationId: scope.organizationId,
      teamId: scope.teamId,
      projectId,
      departmentId: scope.departmentId,
      isPersonal: scope.isPersonal,
    };
  }
}

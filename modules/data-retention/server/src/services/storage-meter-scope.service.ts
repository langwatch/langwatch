/**
 * Total stored bytes for the projects a scope resolves to, RBAC-filtered to the ones the caller
 * may read. The Data Storage card uses this so the number tracks the page's scope selector
 * (organization / team / project) instead of only ever showing the project on the top nav.
 */
import type { RetentionStorageUsage, ScopeAssignment } from "@langwatch/data-retention-contract";
import type { DataRetentionDirectoryRepository } from "../repositories/data-retention-directory.repository.ts";
import type { RetentionActor } from "./data-retention-policy.service.ts";
import type { RetentionPermissionsService } from "./retention-permissions.service.ts";
import type { StorageMeterService } from "./storage-meter.service.ts";

export type StorageMeterScopeServiceOptions = Readonly<{
  meter: Pick<StorageMeterService, "getTotalStorageBytes" | "getTotalStorageBytesForTenants">;
  directory: DataRetentionDirectoryRepository;
  permissions: RetentionPermissionsService;
}>;

export class StorageMeterScopeService {
  static create(options: StorageMeterScopeServiceOptions): StorageMeterScopeService {
    return new StorageMeterScopeService(options);
  }

  private constructor(private readonly options: StorageMeterScopeServiceOptions) {}

  async getScopeUsage(input: {
    projectId: string;
    scope: ScopeAssignment;
    actor: RetentionActor;
  }): Promise<RetentionStorageUsage> {
    const { projectId, scope, actor } = input;
    const { directory, permissions, meter } = this.options;

    const lineage = await directory.findProjectLineage({ projectId });
    const organizationId = lineage?.organizationId ?? null;

    // Personal-account project (no organization): the scope can only be the
    // project itself, already authorized by the route's project:view guard.
    if (!organizationId) {
      const totalBytes = await meter.getTotalStorageBytes({ tenantId: projectId });

      return { totalBytes, projectCount: 1 };
    }

    const candidates = await directory.listScopeProjects({ organizationId, scope });
    if (candidates.length === 0) {
      return { totalBytes: 0, projectCount: 0 };
    }

    const decided = await permissions.canViewTraces({
      userId: actor.userId,
      organizationId,
      projectIds: candidates.map((project) => project.id),
    });

    const authorizedIds = candidates
      .map((project) => project.id)
      .filter((id) => decided.get(id) === true);

    const totalBytes = await meter.getTotalStorageBytesForTenants({
      tenantIds: authorizedIds,
    });

    return { totalBytes, projectCount: authorizedIds.length };
  }
}

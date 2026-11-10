/**
 * How many stored items each category keeps past the period its projects resolve to, summed over
 * the scope's projects the caller may read: what applying the period now would delete.
 * Spec: modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import type { ScopeAssignment, StoredPastRetention } from "@langwatch/data-retention-contract";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { RetentionActor } from "./data-retention-policy.service.ts";
import type { DataRetentionService } from "./data-retention.service.ts";
import type { RetentionPermissionsService } from "./retention-permissions.service.ts";

type Options = Readonly<{
  retention: Pick<DataRetentionService, "countPastRetention">;
  directory: DataRetentionDirectoryReader;
  permissions: Pick<RetentionPermissionsService, "canViewTraces">;
}>;

export class StoredPastRetentionService {
  static create(options: Options): StoredPastRetentionService {
    return new StoredPastRetentionService(options);
  }

  private constructor(private readonly options: Options) {}

  async getForScope({
    projectId,
    scope,
    actor,
    nowMs,
  }: {
    projectId: string;
    scope: ScopeAssignment;
    actor: RetentionActor;
    nowMs: number;
  }): Promise<StoredPastRetention> {
    const projectIds = await this.readableProjectIds({ projectId, scope, actor });
    const categories = await this.options.retention.countPastRetention({ projectIds, nowMs });
    return { categories, projectCount: projectIds.length };
  }

  /** A personal project (no organization) is only ever its own scope, which the door approved. */
  private async readableProjectIds({
    projectId,
    scope,
    actor,
  }: {
    projectId: string;
    scope: ScopeAssignment;
    actor: RetentionActor;
  }): Promise<string[]> {
    const { directory, permissions } = this.options;
    const organizationId = (await directory.findProjectLineage({ projectId }))?.organizationId;
    if (!organizationId) return [projectId];

    const candidates = (await directory.findScopeProjects({ organizationId, scope })).map(
      (project) => project.id,
    );
    if (candidates.length === 0) return [];
    const decided = await permissions.canViewTraces({
      userId: actor.userId,
      organizationId,
      projectIds: candidates,
    });
    return candidates.filter((id) => decided.get(id) === true);
  }
}

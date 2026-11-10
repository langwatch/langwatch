/**
 * How many stored items each category keeps past the period its projects resolve to, summed over
 * the scope's projects the caller may read: what applying the period now would delete.
 * Spec: modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import {
  retentionCategories,
  type ScopeAssignment,
  type StoredPastRetention,
} from "@langwatch/data-retention-contract";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import type { RetentionActor } from "./data-retention-policy.service.ts";
import type { DataRetentionService } from "./data-retention.service.ts";
import type { RetentionPermissionsService } from "./retention-permissions.service.ts";

type Options = Readonly<{
  retention: Pick<DataRetentionService, "getResolvedForProjects">;
  retroactive: Pick<RetroactiveRetentionRepository, "countPastRetention">;
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
    const categories = await this.countPastRetention({ projectIds, nowMs });
    return { categories, projectCount: projectIds.length };
  }

  /** A category's `retentionDays` is null when the projects resolve to different periods. */
  private async countPastRetention({
    projectIds,
    nowMs,
  }: {
    projectIds: readonly string[];
    nowMs: number;
  }): Promise<StoredPastRetention["categories"]> {
    const resolved = await this.options.retention.getResolvedForProjects({ projectIds });
    return Promise.all(
      retentionCategories.map(async (category) => {
        const days = [...resolved.values()].map((retention) => retention[category]);
        const counts = await Promise.all(
          [...resolved].map(([projectId, retention]) =>
            this.options.retroactive.countPastRetention({
              projectId,
              category,
              retentionDays: retention[category],
              nowMs,
            }),
          ),
        );
        return {
          category,
          rows: counts.reduce((sum, count) => sum + count, 0),
          retentionDays: new Set(days).size === 1 ? (days[0] ?? null) : null,
        };
      }),
    );
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

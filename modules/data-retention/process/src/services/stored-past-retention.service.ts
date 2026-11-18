/**
 * Stored items per category kept past their projects' period, over every project an Apply on the
 * scope rewrites (archived included). Aggregate only: no project is named.
 * Spec: modules/data-retention/specs/retention-apply-to-stored-data.feature
 */
import {
  retentionCategories,
  type RetentionCategory,
  type ScopeAssignment,
  type StoredPastRetention,
  type StoredPastRetentionCount,
} from "@langwatch/data-retention-contract";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { StoredPastRetentionOwners } from "../channels/data-retention.channels.ts";
import type { DataRetentionService } from "./data-retention.service.ts";

type Options = Readonly<{
  retention: Pick<
    DataRetentionService,
    "getResolvedForProjects" | "findScopeProjectIds" | "assertScopeInOrganization"
  >;
  /** The module storing each category, asked for its own count (ADR-202 Decided 20). */
  owners: StoredPastRetentionOwners;
  directory: Pick<DataRetentionDirectoryReader, "findProjectLineage">;
}>;

const DAY_MS = 86_400_000;

export class StoredPastRetentionService {
  static create(options: Options): StoredPastRetentionService {
    return new StoredPastRetentionService(options);
  }

  private constructor(private readonly options: Options) {}

  async getForScope({
    projectId,
    scope,
    nowMs,
  }: {
    projectId: string;
    scope: ScopeAssignment;
    nowMs: number;
  }): Promise<StoredPastRetention> {
    const projectIds = await this.appliedProjectIds({ projectId, scope });
    const resolved = await this.options.retention.getResolvedForProjects({ projectIds });
    const counted = new Map<RetentionCategory, StoredPastRetentionCount>();
    for (const category of retentionCategories) {
      counted.set(category, await this.countCategory({ category, resolved, nowMs }));
    }
    const countOf = (category: RetentionCategory): StoredPastRetentionCount =>
      counted.get(category) ?? { rows: 0, retentionDays: null };
    return {
      projectCount: projectIds.length,
      traces: countOf("traces"),
      scenarios: countOf("scenarios"),
      experiments: countOf("experiments"),
    };
  }

  /**
   * One project at a time, so a page load holds at most one read. `retentionDays` is null when
   * the projects resolve to different periods for the category.
   */
  private async countCategory({
    category,
    resolved,
    nowMs,
  }: {
    category: RetentionCategory;
    resolved: ReadonlyMap<string, Readonly<Record<RetentionCategory, number>>>;
    nowMs: number;
  }): Promise<StoredPastRetentionCount> {
    let rows = 0;
    for (const [projectId, retention] of resolved) {
      const retentionDays = retention[category];
      // A project keeping the category forever has nothing past its period.
      if (retentionDays === 0) continue;
      rows += await this.options.owners[category].countStoredPastRetention({
        projectId,
        beforeMs: nowMs - retentionDays * DAY_MS,
        retentionDays,
      });
    }
    const days = new Set([...resolved.values()].map((retention) => retention[category]));
    const [only] = days;
    return { rows, retentionDays: days.size === 1 && only !== undefined ? only : null };
  }

  /**
   * The projects `applyScopeRetentionToStoredData` rewrites. A personal project (no organization)
   * is only ever its own scope, which the door approved.
   */
  private async appliedProjectIds({
    projectId,
    scope,
  }: {
    projectId: string;
    scope: ScopeAssignment;
  }): Promise<readonly string[]> {
    const { directory, retention } = this.options;
    const organizationId = (await directory.findProjectLineage({ projectId }))?.organizationId;
    if (!organizationId) return [projectId];

    await retention.assertScopeInOrganization({ organizationId, scope });
    return retention.findScopeProjectIds({ organizationId, scope });
  }
}

import type { RetentionPolicy } from "@prisma/client";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import {
  type RetentionRow,
  resolveRetention,
} from "../resolveRetentionDays";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  type ResolvedRetention,
  type RetentionCategory,
} from "../retentionPolicy.schema";
import type { RetentionPolicyCache } from "../retentionPolicyCache";
import type { DataRetentionPolicyRepository } from "./dataRetentionPolicy.repository";

export class ScopeTargetNotFoundError extends Error {
  name = "ScopeTargetNotFoundError" as const;
}

export class DataRetentionPolicyService {
  constructor(
    private readonly repository: DataRetentionPolicyRepository,
    private readonly retentionPolicyCache: RetentionPolicyCache,
  ) {}

  /**
   * The effective per-category retention a project resolves to today. Walks
   * PROJECT → TEAM → ORGANIZATION, most-specific-wins. When the project has no
   * resolvable scope context the cache returns null; we fall back to the
   * platform default rather than 0, because retention is default-on (absence of
   * an override means "use the platform default", not "keep indefinitely").
   * Delegates to the cache so the resolution path has a single definition.
   */
  async getResolvedForProject(projectId: string): Promise<ResolvedRetention> {
    const resolved = await this.retentionPolicyCache.resolve(projectId);
    return (
      resolved ?? {
        traces: PLATFORM_DEFAULT_RETENTION_DAYS,
        scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
        experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
      }
    );
  }

  /**
   * The retention each category would fall back to if every override at `scope`
   * were removed — i.e. the value the next tier in the cascade supplies, or the
   * platform default when nothing closer applies. Pure preview (no mutation):
   * reads the org's rows, drops the scope's own rows, and re-resolves the
   * scope's own cascade chain. Reuses `resolveRetention` so the fallback can
   * never diverge from what an actual removal would produce. Returns only day
   * counts — a caller who can manage this scope never learns a sibling scope's
   * rule identity, only the number their data would land on.
   */
  async previewScopeRemoval(
    scope: ScopeAssignment,
  ): Promise<ResolvedRetention> {
    const organizationId =
      await this.repository.findOrganizationForScope(scope);
    if (!organizationId) {
      return {
        traces: PLATFORM_DEFAULT_RETENTION_DAYS,
        scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
        experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
      };
    }
    const rows = await this.repository.findAllInOrganization(organizationId);
    const remaining = rows.filter(
      (r) =>
        !(r.scopeType === scope.scopeType && r.scopeId === scope.scopeId),
    ) as RetentionRow[];
    const chain = await this.repository.getScopeCascadeChain(scope);
    return resolveRetention({ rows: remaining, chain });
  }

  /** Every retention override row in the organization (unfiltered). */
  async listOrganizationRules(
    organizationId: string,
  ): Promise<RetentionPolicy[]> {
    return this.repository.findAllInOrganization(organizationId);
  }

  async getRowById(id: string): Promise<RetentionPolicy | null> {
    return this.repository.findById(id);
  }

  /**
   * Set a single category's retention at one scope. The caller (router) must
   * have already authorized manage on the scope. Anchors the row to the
   * scope's owning organization and invalidates the resolved cache for every
   * project the scope's cascade reaches.
   */
  async setForScope({
    scope,
    category,
    retentionDays,
  }: {
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const organizationId =
      await this.repository.findOrganizationForScope(scope);
    if (!organizationId) {
      throw new ScopeTargetNotFoundError("Scope target not found.");
    }

    const row = await this.repository.upsertForScope({
      organizationId,
      scope,
      category,
      retentionDays,
    });

    await this.invalidateForScope(scope);
    return row;
  }

  /** Remove a category's override at one scope; the next tier then applies. */
  async removeForScope({
    scope,
    category,
  }: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    await this.repository.deleteForScope({ scope, category });
    await this.invalidateForScope(scope);
  }

  private async invalidateForScope(scope: ScopeAssignment): Promise<void> {
    const projectIds = await this.repository.findAffectedProjectIds(scope);
    for (const id of projectIds) {
      this.retentionPolicyCache.invalidate(id);
    }
  }
}

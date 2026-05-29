import type { PrismaClient, RetentionPolicy } from "@prisma/client";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { resolveOrganizationForScope } from "~/server/scopes/resolveOrganizationForScope";
import type { RetentionPolicyCache } from "../retentionPolicyCache";
import type {
  RetentionCategory,
  ResolvedRetention,
} from "../retentionPolicy.schema";
import type { DataRetentionPolicyRepository } from "./dataRetentionPolicy.repository";

export class ScopeTargetNotFoundError extends Error {
  name = "ScopeTargetNotFoundError" as const;
}

export class DataRetentionPolicyService {
  constructor(
    private readonly repository: DataRetentionPolicyRepository,
    private readonly retentionPolicyCache: RetentionPolicyCache,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * The effective per-category retention a project resolves to today (0 =
   * indefinite). Walks PROJECT → TEAM → ORGANIZATION, most-specific-wins.
   * Delegates to the cache so the resolution path has a single definition.
   */
  async getResolvedForProject(projectId: string): Promise<ResolvedRetention> {
    const resolved = await this.retentionPolicyCache.resolve(projectId);
    return resolved ?? { traces: 0, scenarios: 0, experiments: 0 };
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
    const organizationId = await resolveOrganizationForScope(
      this.prisma,
      scope,
    );
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

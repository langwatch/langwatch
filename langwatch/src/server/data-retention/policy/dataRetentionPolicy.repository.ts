import type { PrismaClient, RetentionPolicy } from "@prisma/client";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { resolveOrganizationForScope } from "~/server/scopes/resolveOrganizationForScope";
import { resolveScopeChain } from "~/server/scopes/resolveScopeChain";
import type { RetentionCategory } from "../retentionPolicy.schema";

export interface ProjectScopeContext {
  organizationId: string;
  teamId: string;
  projectId: string;
}

/**
 * Repository for the scoped `RetentionPolicy` table (ADR-021 inline
 * single-scope-per-row). All reads are bounded by `organizationId` + a
 * `(scopeType, scopeId)` predicate so the tenancy guard is satisfied; all
 * writes carry the resolved owning `organizationId`.
 */
export class DataRetentionPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve a project's `(organizationId, teamId, projectId)` triple, the
   * input every scope query needs. Returns null for a project with no team
   * (personal-account edge — retention scoping needs an org anchor).
   */
  async getProjectScopeContext(
    projectId: string,
  ): Promise<ProjectScopeContext | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    if (!project?.team) return null;
    return {
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      projectId,
    };
  }

  /**
   * Every retention row in the project's PROJECT → TEAM → ORGANIZATION
   * cascade. The caller resolves the cascade; this returns the raw rows so the
   * resolver and the grouped read can both consume them.
   */
  async findForProjectChain(
    ctx: ProjectScopeContext,
  ): Promise<RetentionPolicy[]> {
    const chain = resolveScopeChain(ctx);
    return this.prisma.retentionPolicy.findMany({
      where: {
        organizationId: ctx.organizationId,
        OR: chain.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      },
    });
  }

  /**
   * Every retention row anywhere in the organization. Used by the settings
   * page to render the full override landscape; the service filters to the
   * scopes the caller can read.
   */
  async findAllInOrganization(
    organizationId: string,
  ): Promise<RetentionPolicy[]> {
    return this.prisma.retentionPolicy.findMany({
      where: { organizationId },
    });
  }

  async upsertForScope({
    organizationId,
    scope,
    category,
    retentionDays,
  }: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    return this.prisma.retentionPolicy.upsert({
      where: {
        scopeType_scopeId_category: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          category,
        },
      },
      update: { retentionDays, organizationId },
      create: {
        organizationId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        category,
        retentionDays,
      },
    });
  }

  async deleteForScope({
    scope,
    category,
  }: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    await this.prisma.retentionPolicy.deleteMany({
      where: {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        category,
      },
    });
  }

  async findById(id: string): Promise<RetentionPolicy | null> {
    return this.prisma.retentionPolicy.findUnique({ where: { id } });
  }

  /**
   * Resolve the organization a (scopeType, scopeId) target belongs to.
   * Wraps the generic scope resolver so the service can stay free of
   * raw Prisma access.
   */
  async findOrganizationForScope(
    scope: ScopeAssignment,
  ): Promise<string | null> {
    return resolveOrganizationForScope(this.prisma, scope);
  }

  /**
   * Project ids whose resolved retention could change when a row at `scope`
   * is written or removed — i.e. every project the scope's cascade reaches.
   * ORGANIZATION → all projects in the org; TEAM → all projects in the team;
   * PROJECT → that one project. Drives cache invalidation.
   */
  async findAffectedProjectIds(scope: ScopeAssignment): Promise<string[]> {
    if (scope.scopeType === "PROJECT") {
      return [scope.scopeId];
    }
    const where =
      scope.scopeType === "TEAM"
        ? { teamId: scope.scopeId }
        : { team: { organizationId: scope.scopeId } };
    const projects = await this.prisma.project.findMany({
      where,
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }
}

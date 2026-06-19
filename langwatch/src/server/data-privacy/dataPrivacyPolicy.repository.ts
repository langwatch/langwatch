import type { DataPrivacyPolicy, Prisma, PrismaClient } from "@prisma/client";
import { resolveOrganizationForScope } from "~/server/scopes/resolveOrganizationForScope";
import { createLogger } from "~/utils/logger/server";
import {
  type DataPrivacyConfig,
  dataPrivacyConfigSchema,
} from "./dataPrivacy.types";
import {
  buildDataPrivacyChain,
  type DataPrivacyRow,
  type DataPrivacyScopeFacts,
} from "./resolveDataPrivacy";

const logger = createLogger("langwatch:data-privacy:repository");

/**
 * The four tiers a privacy rule can target. DEPARTMENT extends the universal
 * ORGANIZATION/TEAM/PROJECT scope contract (the people lens), so the tier type
 * derives from the resolver's row contract rather than the shared `ScopeTier`.
 */
export type DataPrivacyScopeTier = DataPrivacyRow["scopeType"];

export interface DataPrivacyScope {
  scopeType: DataPrivacyScopeTier;
  scopeId: string;
}

/**
 * Repository for the scoped `DataPrivacyPolicy` table (ADR-021 inline
 * single-scope-per-row, one row per (scope, personalOnly)). All reads are
 * bounded by `organizationId` + a `(scopeType, scopeId)` predicate so the
 * tenancy guard is satisfied; all writes carry the resolved owning
 * `organizationId`.
 */
export class DataPrivacyPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve the facts the privacy cascade needs for a project. For a personal
   * project `departmentId` is the OWNER's department (matching how the chain
   * builds the personal department candidates); for a regular project it is
   * the project's own department. Returns null for a project with no team
   * (personal-account edge, privacy scoping needs an org anchor).
   */
  async getProjectScopeFacts({
    projectId,
  }: {
    projectId: string;
  }): Promise<DataPrivacyScopeFacts | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: {
        teamId: true,
        isPersonal: true,
        ownerUserId: true,
        departmentId: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project?.team) return null;
    const organizationId = project.team.organizationId;

    let departmentId: string | null = null;
    if (project.isPersonal) {
      if (project.ownerUserId) {
        const ownerMembership = await this.prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: project.ownerUserId,
              organizationId,
            },
          },
          select: { departmentId: true },
        });
        departmentId = ownerMembership?.departmentId ?? null;
      }
    } else {
      departmentId = project.departmentId;
    }

    return {
      organizationId,
      teamId: project.teamId,
      projectId,
      departmentId,
      isPersonal: project.isPersonal,
    };
  }

  /**
   * Every privacy row matching any candidate of the project's cascade,
   * bounded by the organization anchor. Both `personalOnly` variants of each
   * (scopeType, scopeId) pair are fetched; `resolveDataPrivacy` walks the
   * chain and picks the candidates that apply. Rows whose stored config no
   * longer parses (hand-edited JSON) are skipped with a warning rather than
   * failing the whole resolution.
   */
  async findForProjectChain(
    facts: DataPrivacyScopeFacts,
  ): Promise<DataPrivacyRow[]> {
    const seen = new Set<string>();
    const pairs: { scopeType: DataPrivacyScopeTier; scopeId: string }[] = [];
    for (const { scopeType, scopeId } of buildDataPrivacyChain(facts)) {
      const key = `${scopeType}:${scopeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ scopeType, scopeId });
    }

    const rows = await this.prisma.dataPrivacyPolicy.findMany({
      where: {
        organizationId: facts.organizationId,
        OR: pairs.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      },
    });
    return rows.flatMap((row) => this.toResolverRow(row));
  }

  /**
   * Every privacy row anywhere in the organization. Used by the settings page
   * to render the full rule landscape; the read layer filters to the scopes
   * the caller can read.
   */
  async findAllInOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DataPrivacyPolicy[]> {
    return this.prisma.dataPrivacyPolicy.findMany({
      where: { organizationId },
    });
  }

  async upsertForScope({
    organizationId,
    scope,
    personalOnly,
    config,
  }: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    const configJson = config as Prisma.InputJsonValue;
    return this.prisma.dataPrivacyPolicy.upsert({
      where: {
        scopeType_scopeId_personalOnly: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          personalOnly,
        },
      },
      update: { config: configJson, organizationId },
      create: {
        organizationId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        personalOnly,
        config: configJson,
      },
    });
  }

  async deleteForScope({
    scope,
    personalOnly,
  }: {
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    await this.prisma.dataPrivacyPolicy.deleteMany({
      where: {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        personalOnly,
      },
    });
  }

  async findById(id: string): Promise<DataPrivacyPolicy | null> {
    return this.prisma.dataPrivacyPolicy.findUnique({ where: { id } });
  }

  /**
   * Resolve the organization a (scopeType, scopeId) target belongs to.
   * DEPARTMENT resolves through its own table (the generic scope resolver
   * only knows the universal three tiers); everything else delegates to it.
   */
  async findOrganizationForScope(
    scope: DataPrivacyScope,
  ): Promise<string | null> {
    if (scope.scopeType === "DEPARTMENT") {
      const department = await this.prisma.department.findUnique({
        where: { id: scope.scopeId },
        select: { organizationId: true },
      });
      return department?.organizationId ?? null;
    }
    return resolveOrganizationForScope(this.prisma, {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    });
  }

  /**
   * Project ids whose resolved privacy could change when a row at `scope` is
   * written or removed, i.e. every project the scope's cascade reaches.
   * Drives cache invalidation.
   *
   * ORGANIZATION reaches every project in the org (`personalOnly` narrows to
   * personal projects). TEAM reaches the team's projects and PROJECT exactly
   * that project (their chain candidates are never personal-only). DEPARTMENT
   * reaches projects assigned to the department directly (the project lens)
   * plus personal projects whose OWNER sits in the department (the people
   * lens, how the chain resolves a personal project's department);
   * `personalOnly` keeps only the personal-project side.
   */
  async findAffectedProjectIds({
    scope,
    personalOnly,
  }: {
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<string[]> {
    if (scope.scopeType === "PROJECT") {
      return [scope.scopeId];
    }

    if (scope.scopeType === "TEAM") {
      const projects = await this.prisma.project.findMany({
        where: { teamId: scope.scopeId },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }

    if (scope.scopeType === "ORGANIZATION") {
      const projects = await this.prisma.project.findMany({
        where: {
          team: { organizationId: scope.scopeId },
          ...(personalOnly ? { isPersonal: true } : {}),
        },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }

    const department = await this.prisma.department.findUnique({
      where: { id: scope.scopeId },
      select: { organizationId: true },
    });
    if (!department) return [];

    const members = await this.prisma.organizationUser.findMany({
      where: {
        organizationId: department.organizationId,
        departmentId: scope.scopeId,
      },
      select: { userId: true },
    });
    const memberUserIds = members.map((m) => m.userId);

    const reach: Prisma.ProjectWhereInput[] = [];
    if (!personalOnly) {
      reach.push({ departmentId: scope.scopeId });
    }
    if (memberUserIds.length > 0) {
      reach.push({
        isPersonal: true,
        ownerUserId: { in: memberUserIds },
        team: { organizationId: department.organizationId },
      });
    }
    if (reach.length === 0) return [];

    const projects = await this.prisma.project.findMany({
      where: { OR: reach },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  private toResolverRow(row: DataPrivacyPolicy): DataPrivacyRow[] {
    const parsed = dataPrivacyConfigSchema.safeParse(row.config);
    if (!parsed.success) {
      logger.warn(
        {
          ruleId: row.id,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          personalOnly: row.personalOnly,
        },
        "Skipping data-privacy rule whose stored config does not parse",
      );
      return [];
    }
    return [
      {
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        personalOnly: row.personalOnly,
        config: parsed.data,
      },
    ];
  }
}

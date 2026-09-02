/**
 * The organization lineage behind the privacy settings page, over Prisma.
 *
 * Moved out of the application process: the reads, the orderings and the
 * archived-department rule are the ones the page has always been served. The
 * one change is that the project row is read ONCE — the application read it
 * twice, once for its lineage and again for its name on the personal-account
 * branch — because a second read of the same row by primary key answers the
 * same thing.
 */
import type { DataPrivacyScope } from "@langwatch/data-privacy-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  DataPrivacyDirectoryPort,
  type DataPrivacyOrganizationDirectory,
  type DataPrivacyProjectLineage,
} from "../../ports/data-privacy-directory.port";

/** Only what this repository touches. */
export type DataPrivacyDirectoryDatabase = Pick<
  PrismaClient,
  "project" | "team" | "department" | "group" | "organization"
>;

export class PrismaDataPrivacyDirectoryRepository extends DataPrivacyDirectoryPort {
  static create(database: DataPrivacyDirectoryDatabase): PrismaDataPrivacyDirectoryRepository {
    return new PrismaDataPrivacyDirectoryRepository(database);
  }

  private constructor(private readonly database: DataPrivacyDirectoryDatabase) {
    super();
  }

  async tryGetProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<DataPrivacyProjectLineage | null> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        teamId: true,
        team: {
          select: {
            organizationId: true,
            organization: { select: { name: true } },
          },
        },
      },
    });
    if (!project) return null;
    return {
      projectId: project.id,
      name: project.name,
      teamId: project.teamId,
      organizationId: project.team?.organizationId ?? null,
      organizationName: project.team?.organization?.name ?? null,
    };
  }

  async listOrganizationDirectory({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DataPrivacyOrganizationDirectory> {
    const [departments, teams, projects, groups] = await Promise.all([
      this.database.department.findMany({
        where: { organizationId },
        select: { id: true, name: true, archivedAt: true },
        orderBy: { name: "asc" },
      }),
      this.database.team.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.database.project.findMany({
        where: { team: { organizationId } },
        select: { id: true, name: true, teamId: true },
        orderBy: { name: "asc" },
      }),
      this.database.group.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      departments: departments.map(({ id, name, archivedAt }) => ({
        id,
        name,
        archived: archivedAt !== null,
      })),
      teams,
      projects,
      groups,
    };
  }

  async tryResolveScopeOrganizationId({
    scope,
  }: {
    scope: DataPrivacyScope;
  }): Promise<string | null> {
    if (scope.scopeType === "ORGANIZATION") {
      const organization = await this.database.organization.findUnique({
        where: { id: scope.scopeId },
        select: { id: true },
      });
      return organization?.id ?? null;
    }
    if (scope.scopeType === "DEPARTMENT") {
      const department = await this.database.department.findUnique({
        where: { id: scope.scopeId },
        select: { organizationId: true },
      });
      return department?.organizationId ?? null;
    }
    if (scope.scopeType === "TEAM") {
      const team = await this.database.team.findUnique({
        where: { id: scope.scopeId },
        select: { organizationId: true },
      });
      return team?.organizationId ?? null;
    }
    const project = await this.database.project.findUnique({
      where: { id: scope.scopeId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team?.organizationId ?? null;
  }
}

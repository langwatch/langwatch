/**
 * Organization lineage repository over Prisma: moved from the application
 * process, now reads the project row once instead of twice.
 */
import type { DataPrivacyScope } from "@langwatch/data-privacy-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type DataPrivacyDirectoryReader,
  type DataPrivacyOrganizationDirectory,
  type DataPrivacyProjectLineage,
} from "../../app/data-privacy.app.ts";

/** Only what this repository touches. */
export type DataPrivacyDirectoryDatabase = Pick<
  PrismaClient,
  "project" | "team" | "department" | "group" | "organization"
>;

export class PrismaDataPrivacyDirectoryRepository implements DataPrivacyDirectoryReader {
  static create(database: DataPrivacyDirectoryDatabase): PrismaDataPrivacyDirectoryRepository {
    return new PrismaDataPrivacyDirectoryRepository(database);
  }

  private constructor(private readonly database: DataPrivacyDirectoryDatabase) {}

  async findProjectLineage({
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

  async findOrganizationDirectory({
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

  async findScopeOrganizationId({ scope }: { scope: DataPrivacyScope }): Promise<string | null> {
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

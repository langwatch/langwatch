/**
 * The organization lineage behind the retention settings page, over Prisma.
 *
 * Moved out of the application process: the reads, the orderings and the
 * archived-project rule are the ones the page has always been served. The one
 * change is that the project row is read ONCE — the application read it twice,
 * for its lineage and again for its name on the personal-account branch —
 * because a second read of the same row by primary key answers the same thing.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  DataRetentionDirectoryPort,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
  type RetentionScopeTarget,
} from "../../ports/data-retention-directory.port";

/** Only what this repository touches. */
export type DataRetentionDirectoryDatabase = Pick<
  PrismaClient,
  "project" | "team" | "organization"
>;

export class PrismaDataRetentionDirectoryRepository extends DataRetentionDirectoryPort {
  static create(database: DataRetentionDirectoryDatabase): PrismaDataRetentionDirectoryRepository {
    return new PrismaDataRetentionDirectoryRepository(database);
  }

  private constructor(private readonly database: DataRetentionDirectoryDatabase) {
    super();
  }

  async tryGetProjectLineage({
    projectId,
  }: {
    projectId: string;
  }): Promise<RetentionProjectLineage | null> {
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
  }): Promise<RetentionOrganizationDirectory> {
    const [teams, projects] = await Promise.all([
      this.database.team.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.database.project.findMany({
        where: { team: { organizationId } },
        // `archivedAt` is SELECTED rather than filtered so a rule targeting a
        // since-archived project still resolves its name; the picker is where
        // the archived ones are dropped.
        select: { id: true, name: true, teamId: true, archivedAt: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return {
      teams,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        teamId: project.teamId,
        archived: project.archivedAt !== null,
      })),
    };
  }

  async tryResolveScopeOrganizationId({
    scope,
  }: {
    scope: RetentionScopeTarget;
  }): Promise<string | null> {
    if (scope.scopeType === "ORGANIZATION") {
      const organization = await this.database.organization.findUnique({
        where: { id: scope.scopeId },
        select: { id: true },
      });
      return organization?.id ?? null;
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

  async listScopeProjects({
    organizationId,
    scope,
  }: {
    organizationId: string;
    scope: RetentionScopeTarget;
  }): Promise<ReadonlyArray<{ id: string; teamId: string }>> {
    // The organization constraint is what makes a foreign scopeId resolve to
    // nothing, whichever tier the scope names.
    const where =
      scope.scopeType === "PROJECT"
        ? { id: scope.scopeId, team: { organizationId }, archivedAt: null }
        : scope.scopeType === "TEAM"
          ? { teamId: scope.scopeId, team: { organizationId }, archivedAt: null }
          : { team: { organizationId }, archivedAt: null };

    return await this.database.project.findMany({
      where,
      select: { id: true, teamId: true },
    });
  }
}

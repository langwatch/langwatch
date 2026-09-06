import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Exactly the model delegate methods this task calls, picked from the real `PrismaClient`
 * rather than hand-typed, so a real `PrismaClient` satisfies this narrower shape for free.
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

/**
 * Deliberately unprotected (no `projectId`/`organizationId` scoping): this walk is cross-tenant
 * by design — the one place in the product that discovers and removes a single user's data
 * across every organization they touched, across ~25 tables no single feature's port fronts.
 */
export type GdprUserDataEraseDatabase = {
  user: Delegate<"user", "findUnique" | "delete">;
  organization: Delegate<"organization", "findMany" | "deleteMany">;
  organizationUser: Delegate<"organizationUser", "count" | "deleteMany">;
  team: Delegate<"team", "findMany" | "deleteMany">;
  teamUser: Delegate<"teamUser", "deleteMany">;
  project: Delegate<"project", "findMany" | "deleteMany">;
  account: Delegate<"account", "count" | "deleteMany">;
  session: Delegate<"session", "count" | "deleteMany">;
  annotation: Delegate<"annotation", "count" | "updateMany" | "deleteMany">;
  shareLink: Delegate<"shareLink", "count" | "updateMany" | "deleteMany">;
  workflow: Delegate<"workflow", "count" | "updateMany" | "deleteMany">;
  workflowVersion: Delegate<"workflowVersion", "count" | "deleteMany">;
  llmPromptConfig: Delegate<"llmPromptConfig", "findMany" | "deleteMany">;
  llmPromptConfigVersion: Delegate<"llmPromptConfigVersion", "count" | "updateMany" | "deleteMany">;
  annotationQueueItem: Delegate<"annotationQueueItem", "count" | "updateMany" | "deleteMany">;
  annotationQueueMembers: Delegate<"annotationQueueMembers", "count" | "deleteMany">;
  annotationQueueScores: Delegate<"annotationQueueScores", "deleteMany">;
  annotationQueue: Delegate<"annotationQueue", "findMany" | "deleteMany">;
  auditLog: Delegate<"auditLog", "count" | "updateMany">;
  batchEvaluation: Delegate<"batchEvaluation", "deleteMany">;
  monitor: Delegate<"monitor", "deleteMany">;
  experiment: Delegate<"experiment", "deleteMany">;
  datasetRecord: Delegate<"datasetRecord", "deleteMany">;
  dataset: Delegate<"dataset", "deleteMany">;
  customGraph: Delegate<"customGraph", "deleteMany">;
  dashboard: Delegate<"dashboard", "deleteMany">;
  trigger: Delegate<"trigger", "deleteMany">;
  topic: Delegate<"topic", "deleteMany">;
  cost: Delegate<"cost", "deleteMany">;
  // ModelProvider is organization-scoped (ADR-021); a project's own binding
  // is the scope row, not the provider itself, which other projects in the
  // organization may still use.
  modelProviderScope: Delegate<"modelProviderScope", "deleteMany">;
  $transaction: PrismaClient["$transaction"];
};

export type GdprUser = NonNullable<
  Awaited<ReturnType<GdprUserDataEraseDatabase["user"]["findUnique"]>>
>;
export type GdprOrganizationRow = { id: string; name: string };
export type GdprOrganizationWithMemberCount = GdprOrganizationRow & {
  _count: { members: number };
};

/**
 * The read/erase surface `runGdprUserDataErase` needs, fronting the raw
 * `GdprUserDataEraseDatabase` delegates behind named queries plus the one
 * cross-table erase transaction.
 */
export class GdprUserDataEraseRepository {
  private constructor(private readonly database: GdprUserDataEraseDatabase) {}

  static create({
    database,
  }: {
    database: GdprUserDataEraseDatabase;
  }): GdprUserDataEraseRepository {
    return new GdprUserDataEraseRepository(database);
  }

  findUserByEmail(email: string): Promise<GdprUser | null> {
    return this.database.user.findUnique({ where: { email } });
  }

  findUserById(id: string): Promise<GdprUser | null> {
    return this.database.user.findUnique({ where: { id } });
  }

  findSoleOwnedOrganizations(userId: string): Promise<GdprOrganizationRow[]> {
    return this.database.organization.findMany({
      where: { members: { some: { userId }, every: { userId } } },
      select: { id: true, name: true },
    });
  }

  findSharedOrganizations(userId: string): Promise<GdprOrganizationWithMemberCount[]> {
    return this.database.organization.findMany({
      where: { members: { some: { userId } }, NOT: { members: { every: { userId } } } },
      select: { id: true, name: true, _count: { select: { members: true } } },
    });
  }

  findSoleOwnedTeams(userId: string): Promise<GdprOrganizationRow[]> {
    return this.database.team.findMany({
      where: { members: { some: { userId }, every: { userId } } },
      select: { id: true, name: true },
    });
  }

  findSharedTeams(userId: string): Promise<GdprOrganizationWithMemberCount[]> {
    return this.database.team.findMany({
      where: { members: { some: { userId } }, NOT: { members: { every: { userId } } } },
      select: { id: true, name: true, _count: { select: { members: true } } },
    });
  }

  findProjectsUnderTeams(
    teamIds: string[],
  ): Promise<Array<{ id: string; name: string; slug: string; teamId: string | null }>> {
    if (teamIds.length === 0) return Promise.resolve([]);
    return this.database.project.findMany({
      where: { teamId: { in: teamIds } },
      select: { id: true, name: true, slug: true, teamId: true },
    });
  }

  findSharedOrgsWhereUserIsSoleAdmin(userId: string): Promise<GdprOrganizationRow[]> {
    return this.database.organization.findMany({
      where: {
        members: { some: { userId, role: "ADMIN" } },
        NOT: { members: { every: { userId } } },
      },
      select: { id: true, name: true },
    });
  }

  countOtherAdmins({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<number> {
    return this.database.organizationUser.count({
      where: { organizationId, role: "ADMIN", NOT: { userId } },
    });
  }

  findTeamsUnderSoleOrgsWithOtherMembers({
    organizationIds,
    userId,
  }: {
    organizationIds: string[];
    userId: string;
  }): Promise<GdprOrganizationRow[]> {
    return this.database.team.findMany({
      where: { organizationId: { in: organizationIds }, members: { some: { NOT: { userId } } } },
      select: { id: true, name: true },
    });
  }

  /**
   * In dependency order: nullify what points at the user from entities that
   * outlive them, delete sole-owned projects and their children, delete
   * sole-owned teams and organizations, drop shared memberships, then the
   * user's own rows and the user itself.
   */
  async eraseUserAndOwnedResources({
    userId,
    projectIds,
    soleOwnedTeamIds,
    soleOwnedOrgIds,
  }: {
    userId: string;
    projectIds: string[];
    soleOwnedTeamIds: string[];
    soleOwnedOrgIds: string[];
  }): Promise<void> {
    await this.database.$transaction(
      async (tx) => {
        await tx.annotation.updateMany({ where: { userId }, data: { userId: null } });
        await tx.shareLink.updateMany({ where: { userId }, data: { userId: null } });
        await tx.workflow.updateMany({
          where: { publishedById: userId },
          data: { publishedById: null },
        });
        await tx.workflowVersion.deleteMany({ where: { authorId: userId } });
        await tx.llmPromptConfigVersion.updateMany({
          where: { authorId: userId },
          data: { authorId: null },
        });
        await tx.annotationQueueItem.updateMany({ where: { userId }, data: { userId: null } });
        await tx.annotationQueueItem.updateMany({
          where: { createdByUserId: userId },
          data: { createdByUserId: null },
        });
        await tx.auditLog.updateMany({
          where: { userId },
          data: { userId: "[deleted]", ipAddress: null, userAgent: null },
        });
        await tx.annotationQueueMembers.deleteMany({ where: { userId } });

        if (projectIds.length > 0) {
          const configIds = (
            await tx.llmPromptConfig.findMany({
              where: { projectId: { in: projectIds } },
              select: { id: true },
            })
          ).map((config) => config.id);
          await tx.llmPromptConfigVersion.deleteMany({ where: { configId: { in: configIds } } });
          await tx.llmPromptConfig.deleteMany({ where: { projectId: { in: projectIds } } });

          await tx.workflow.updateMany({
            where: { projectId: { in: projectIds } },
            data: { latestVersionId: null, currentVersionId: null },
          });
          await tx.workflowVersion.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.workflow.deleteMany({ where: { projectId: { in: projectIds } } });

          await tx.batchEvaluation.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.monitor.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.experiment.deleteMany({ where: { projectId: { in: projectIds } } });

          const queueIds = (
            await tx.annotationQueue.findMany({
              where: { projectId: { in: projectIds } },
              select: { id: true },
            })
          ).map((queue) => queue.id);
          await tx.annotationQueueItem.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.annotationQueueScores.deleteMany({
            where: { annotationQueueId: { in: queueIds } },
          });
          await tx.annotationQueueMembers.deleteMany({
            where: { annotationQueueId: { in: queueIds } },
          });
          await tx.annotationQueue.deleteMany({ where: { projectId: { in: projectIds } } });

          await tx.datasetRecord.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.dataset.deleteMany({ where: { projectId: { in: projectIds } } });

          await tx.customGraph.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.dashboard.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.trigger.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.annotation.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.shareLink.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.topic.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.cost.deleteMany({ where: { projectId: { in: projectIds } } });
          await tx.modelProviderScope.deleteMany({
            where: { scopeType: "PROJECT", scopeId: { in: projectIds } },
          });

          await tx.project.deleteMany({ where: { id: { in: projectIds } } });
        }

        if (soleOwnedTeamIds.length > 0) {
          await tx.teamUser.deleteMany({ where: { teamId: { in: soleOwnedTeamIds } } });
          await tx.team.deleteMany({ where: { id: { in: soleOwnedTeamIds } } });
        }

        if (soleOwnedOrgIds.length > 0) {
          await tx.organizationUser.deleteMany({
            where: { organizationId: { in: soleOwnedOrgIds } },
          });
          await tx.organization.deleteMany({ where: { id: { in: soleOwnedOrgIds } } });
        }

        await tx.teamUser.deleteMany({ where: { userId } });
        await tx.organizationUser.deleteMany({ where: { userId } });
        await tx.account.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }
}

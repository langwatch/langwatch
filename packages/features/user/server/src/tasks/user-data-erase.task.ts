import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:task:user-data-erase");

/**
 * Exactly the model delegate methods this task calls, picked from the real
 * `PrismaClient` rather than hand-typed: picking (not re-declaring) keeps
 * `findMany`'s real generic signature, so the row type at each call site
 * comes from the literal `select` passed there — no hand-maintained row
 * type to keep in sync, and a real `PrismaClient` satisfies this narrower
 * shape for free (more methods than picked is still a match).
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

/**
 * Deliberately unprotected (no `projectId`/`organizationId` scoping): this
 * walk is cross-tenant by design — the one place in the product that
 * discovers and removes a single user's data across every organization they
 * touched, across ~25 tables no single feature's port fronts.
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

export type GdprUserDataEraseOutcome = {
  userId: string;
  email: string;
  mode: "dry-run" | "execute";
  soleOwnedOrganizations: number;
  sharedOrganizations: number;
  soleOwnedTeams: number;
  sharedTeams: number;
  soleOwnedProjects: number;
  blockers: string[];
};

async function getSoleOwnedOrganizations(database: GdprUserDataEraseDatabase, userId: string) {
  return database.organization.findMany({
    where: { members: { some: { userId }, every: { userId } } },
    select: { id: true, name: true },
  });
}

async function getSharedOrganizations(database: GdprUserDataEraseDatabase, userId: string) {
  return database.organization.findMany({
    where: { members: { some: { userId } }, NOT: { members: { every: { userId } } } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
}

async function getSoleOwnedTeams(database: GdprUserDataEraseDatabase, userId: string) {
  return database.team.findMany({
    where: { members: { some: { userId }, every: { userId } } },
    select: { id: true, name: true },
  });
}

async function getSharedTeams(database: GdprUserDataEraseDatabase, userId: string) {
  return database.team.findMany({
    where: { members: { some: { userId } }, NOT: { members: { every: { userId } } } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
}

async function getProjectsUnderTeams(database: GdprUserDataEraseDatabase, teamIds: string[]) {
  if (teamIds.length === 0) return [];
  return database.project.findMany({
    where: { teamId: { in: teamIds } },
    select: { id: true, name: true, slug: true, teamId: true },
  });
}

/**
 * The two ways a deletion would strand someone else: this user is the last
 * ADMIN of an organization they don't solely own, or a sole-owned
 * organization has a team someone else still belongs to.
 */
async function checkBlockingConditions(
  database: GdprUserDataEraseDatabase,
  userId: string,
  soleOwnedOrgs: { id: string }[],
): Promise<string[]> {
  const blockers: string[] = [];

  const sharedOrgsWhereUserIsSoleAdmin = await database.organization.findMany({
    where: {
      members: { some: { userId, role: "ADMIN" } },
      NOT: { members: { every: { userId } } },
    },
    select: { id: true, name: true },
  });

  for (const org of sharedOrgsWhereUserIsSoleAdmin) {
    const otherAdmins = await database.organizationUser.count({
      where: { organizationId: org.id, role: "ADMIN", NOT: { userId } },
    });
    if (otherAdmins === 0) {
      blockers.push(
        `User is sole ADMIN of shared organization "${org.name}" (${org.id}). Assign another admin first.`,
      );
    }
  }

  const soleOwnedOrgIds = soleOwnedOrgs.map((org) => org.id);
  const teamsUnderSoleOrgsWithOtherMembers = await database.team.findMany({
    where: { organizationId: { in: soleOwnedOrgIds }, members: { some: { NOT: { userId } } } },
    select: { id: true, name: true },
  });

  for (const team of teamsUnderSoleOrgsWithOtherMembers) {
    blockers.push(
      `Team "${team.name}" (${team.id}) under sole-owned org has other members. Remove them first.`,
    );
  }

  return blockers;
}

/**
 * Deletes every trace of a user for a GDPR erasure request: the user row,
 * every organization/team/project they solely own, and every reference to
 * them elsewhere — nullified where the row outlives the user, anonymized for
 * `AuditLog` (the trail stays, the identity doesn't). Refuses if deleting
 * would strand another member (sole ADMIN of a shared org, or a sole-owned
 * org's team with other members) — those need a human to reassign first.
 *
 * Trace and evaluation data in ClickHouse is not touched here; that erase
 * path does not exist yet (tracked as a follow-up, same as upstream).
 */
export async function runGdprUserDataErase({
  database,
  email,
  execute,
}: {
  database: GdprUserDataEraseDatabase;
  email: string;
  execute: boolean;
}): Promise<GdprUserDataEraseOutcome> {
  const user = await database.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }
  const userId = user.id;

  const [soleOwnedOrgs, sharedOrgs, soleOwnedTeams, sharedTeams] = await Promise.all([
    getSoleOwnedOrganizations(database, userId),
    getSharedOrganizations(database, userId),
    getSoleOwnedTeams(database, userId),
    getSharedTeams(database, userId),
  ]);

  const soleOwnedTeamIds = soleOwnedTeams.map((team) => team.id);
  const projects = await getProjectsUnderTeams(database, soleOwnedTeamIds);
  const blockers = await checkBlockingConditions(database, userId, soleOwnedOrgs);

  const outcome: GdprUserDataEraseOutcome = {
    userId,
    email,
    mode: execute ? "execute" : "dry-run",
    soleOwnedOrganizations: soleOwnedOrgs.length,
    sharedOrganizations: sharedOrgs.length,
    soleOwnedTeams: soleOwnedTeams.length,
    sharedTeams: sharedTeams.length,
    soleOwnedProjects: projects.length,
    blockers,
  };

  logger.info({ outcome }, `GDPR erase report for ${email} (${outcome.mode})`);

  if (blockers.length > 0) {
    throw new Error(`Cannot proceed: ${blockers.join("; ")}`);
  }

  if (!execute) {
    logger.info("Dry run complete — no changes made. Re-run with --execute to apply.");
    return outcome;
  }

  const soleOwnedOrgIds = soleOwnedOrgs.map((org) => org.id);
  const projectIds = projects.map((project) => project.id);

  // In dependency order: nullify what points at the user from entities that
  // outlive them, delete sole-owned projects and their children, delete
  // sole-owned teams and organizations, drop shared memberships, then the
  // user's own rows and the user itself.
  await database.$transaction(
    async (tx) => {
      await tx.annotation.updateMany({ where: { userId }, data: { userId: null } });
      await tx.shareLink.updateMany({ where: { userId }, data: { userId: null } });
      await tx.workflow.updateMany({ where: { publishedById: userId }, data: { publishedById: null } });
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
        await tx.annotationQueueScores.deleteMany({ where: { annotationQueueId: { in: queueIds } } });
        await tx.annotationQueueMembers.deleteMany({ where: { annotationQueueId: { in: queueIds } } });
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
        await tx.modelProviderScope.deleteMany({ where: { scopeType: "PROJECT", scopeId: { in: projectIds } } });

        await tx.project.deleteMany({ where: { id: { in: projectIds } } });
      }

      if (soleOwnedTeamIds.length > 0) {
        await tx.teamUser.deleteMany({ where: { teamId: { in: soleOwnedTeamIds } } });
        await tx.team.deleteMany({ where: { id: { in: soleOwnedTeamIds } } });
      }

      if (soleOwnedOrgIds.length > 0) {
        await tx.organizationUser.deleteMany({ where: { organizationId: { in: soleOwnedOrgIds } } });
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

  const remaining = await database.user.findUnique({ where: { id: userId } });
  if (remaining) {
    throw new Error("Deletion verification failed: user still exists");
  }

  logger.info({ userId, email }, "GDPR erase complete");
  return outcome;
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * user-data-erase -- user@example.com --execute`.
 */
export class UserDataEraseTask extends Task {
  readonly name = "user-data-erase";
  readonly description =
    "Deletes a user's Postgres data for a GDPR erasure request. Pass the email, then --execute to write.";

  private constructor(private readonly database: () => GdprUserDataEraseDatabase) {
    super();
  }

  static create({ database }: { database: () => GdprUserDataEraseDatabase }): UserDataEraseTask {
    return new UserDataEraseTask(database);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const email = args.find((arg) => !arg.startsWith("--"));
    if (!email) {
      throw new Error(
        "Email required: pnpm --filter @langwatch/tasks task user-data-erase -- user@example.com",
      );
    }
    await runGdprUserDataErase({
      database: this.database(),
      email,
      execute: args.includes("--execute"),
    });
  }
}

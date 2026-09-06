import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type { GdprUserDataEraseRepository } from "../repositories/prisma/prisma.user-data-erase.repository";

const logger = createLogger("langwatch:task:user-data-erase");

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

/**
 * The two ways a deletion would strand someone else: this user is the last
 * ADMIN of an organization they don't solely own, or a sole-owned
 * organization has a team someone else still belongs to.
 */
async function checkBlockingConditions(
  repository: GdprUserDataEraseRepository,
  userId: string,
  soleOwnedOrgs: { id: string }[],
): Promise<string[]> {
  const blockers: string[] = [];

  const sharedOrgsWhereUserIsSoleAdmin =
    await repository.findSharedOrgsWhereUserIsSoleAdmin(userId);

  for (const org of sharedOrgsWhereUserIsSoleAdmin) {
    const otherAdmins = await repository.countOtherAdmins({ organizationId: org.id, userId });
    if (otherAdmins === 0) {
      blockers.push(
        `User is sole ADMIN of shared organization "${org.name}" (${org.id}). Assign another admin first.`,
      );
    }
  }

  const soleOwnedOrgIds = soleOwnedOrgs.map((org) => org.id);
  const teamsUnderSoleOrgsWithOtherMembers =
    await repository.findTeamsUnderSoleOrgsWithOtherMembers({
      organizationIds: soleOwnedOrgIds,
      userId,
    });

  for (const team of teamsUnderSoleOrgsWithOtherMembers) {
    blockers.push(
      `Team "${team.name}" (${team.id}) under sole-owned org has other members. Remove them first.`,
    );
  }

  return blockers;
}

/**
 * Deletes every trace of a user for a GDPR erasure request: the user row, every
 * organization/team/project they solely own, and every reference to them elsewhere. Refuses if
 * deleting would strand another member.
 */
export async function runGdprUserDataErase({
  repository,
  email,
  execute,
}: {
  repository: GdprUserDataEraseRepository;
  email: string;
  execute: boolean;
}): Promise<GdprUserDataEraseOutcome> {
  const user = await repository.findUserByEmail(email);
  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }
  const userId = user.id;

  const [soleOwnedOrgs, sharedOrgs, soleOwnedTeams, sharedTeams] = await Promise.all([
    repository.findSoleOwnedOrganizations(userId),
    repository.findSharedOrganizations(userId),
    repository.findSoleOwnedTeams(userId),
    repository.findSharedTeams(userId),
  ]);

  const soleOwnedTeamIds = soleOwnedTeams.map((team) => team.id);
  const projects = await repository.findProjectsUnderTeams(soleOwnedTeamIds);
  const blockers = await checkBlockingConditions(repository, userId, soleOwnedOrgs);

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

  await repository.eraseUserAndOwnedResources({
    userId,
    projectIds,
    soleOwnedTeamIds,
    soleOwnedOrgIds,
  });

  const remaining = await repository.findUserById(userId);
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

  private constructor(private readonly repository: () => GdprUserDataEraseRepository) {
    super();
  }

  static create({
    repository,
  }: {
    repository: () => GdprUserDataEraseRepository;
  }): UserDataEraseTask {
    return new UserDataEraseTask(repository);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const email = args.find((arg) => !arg.startsWith("--"));
    if (!email) {
      throw new Error(
        "Email required: pnpm --filter @langwatch/tasks task user-data-erase -- user@example.com",
      );
    }
    await runGdprUserDataErase({
      repository: this.repository(),
      email,
      execute: args.includes("--execute"),
    });
  }
}

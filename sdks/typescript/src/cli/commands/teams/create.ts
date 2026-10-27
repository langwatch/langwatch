import chalk from "chalk";

import type { ManagementRole } from "@/client-sdk/services/_shared/management-types";
import { TeamsApiService, type Team } from "@/client-sdk/services/teams/teams-api.service";

import type { CommandResult } from "../../utils/output";
import { counted, printFacts, runManagement } from "../management/_shared";
import {
  addMembersToTeam,
  membersByPerson,
  printMembersAdded,
  TeamMembersNotAddedError,
  type TeamMemberToAdd,
  type TeamMembersAdded,
} from "./members";

/** Strongest first: a person holding several built-in roles is copied with the widest. */
const BUILT_IN_ROLES: readonly ManagementRole[] = ["ADMIN", "MEMBER", "VIEWER"];

/**
 * Who a copy adds, with the built-in role each holds on the source team, and
 * who it leaves out. A custom role is not something this route can grant, so
 * a person holding only custom roles is reported rather than downgraded.
 */
export const membersToCopy = (
  rows: Parameters<typeof membersByPerson>[0],
): { copy: TeamMemberToAdd[]; skipped: { userId: string; reason: string }[] } => {
  const copy: TeamMemberToAdd[] = [];
  const skipped: { userId: string; reason: string }[] = [];
  for (const person of membersByPerson(rows)) {
    if (!person.userId) continue;
    const role = BUILT_IN_ROLES.find((builtIn) => person.roles.includes(builtIn));
    if (role) {
      copy.push({ userId: person.userId, role });
    } else {
      skipped.push({
        userId: person.userId,
        reason: "holds only a custom role; bind it with `langwatch role-bindings create`",
      });
    }
  }
  return { copy, skipped };
};

type CreatedTeam = Team & {
  copiedMembers?: TeamMembersAdded & { skipped: { userId: string; reason: string }[] };
};

/**
 * `langwatch teams create --name <name> [--copy-members-from <teamId>]`. With a
 * source team, each of its members is added to the new team with the role
 * they hold there.
 */
export const createTeamCommand = async (options: {
  name: string;
  copyMembersFrom?: string;
}): Promise<CommandResult | void> =>
  runManagement({
    action: "create team",
    pending: options.copyMembersFrom
      ? `Creating team "${options.name}" with the members of team "${options.copyMembersFrom}"...`
      : `Creating team "${options.name}"...`,
    run: async (): Promise<CreatedTeam> => {
      const service = new TeamsApiService();
      // Read the source first: a typo in its id then fails before a team is created.
      const source = options.copyMembersFrom
        ? membersToCopy((await service.listMembers(options.copyMembersFrom)).data)
        : undefined;
      const team = await service.create({ name: options.name });
      if (!source) return team;

      const result = await addMembersToTeam({ service, teamId: team.id, members: source.copy });
      if (result.failed.length > 0) throw new TeamMembersNotAddedError(result);
      return { ...team, copiedMembers: { ...result, skipped: source.skipped } };
    },
    succeed: (team) =>
      team.copiedMembers
        ? `Created team "${chalk.cyan(team.name)}" with ${counted({
            count: team.copiedMembers.added.length,
            singular: "member",
            plural: "members",
          })} copied from team "${options.copyMembersFrom}"`
        : `Created team "${chalk.cyan(team.name)}"`,
    table: (team) => {
      printFacts([
        ["ID", chalk.gray(team.id)],
        ["Name", chalk.cyan(team.name)],
        ["Slug", team.slug],
      ]);
      if (!team.copiedMembers) return;
      printMembersAdded(team.copiedMembers);
      for (const skipped of team.copiedMembers.skipped) {
        console.log(chalk.yellow(`Not copied: ${skipped.userId}, ${skipped.reason}.`));
      }
      if (team.copiedMembers.skipped.length > 0) console.log();
    },
  });

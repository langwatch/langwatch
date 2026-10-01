import chalk from "chalk";

import type { ManagementRole } from "@/client-sdk/services/_shared/management-types";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";

import { readCommandError } from "../../utils/errorOutput";
import { formatTable } from "../../utils/formatting";
import { parseRole } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { counted, orDash, printEmpty, runManagement, withParsedFlags } from "../management/_shared";

type TeamMemberRow = {
  userId: string | null;
  name: string | null;
  email: string | null;
  role: string;
};

/**
 * One row per person, listing every role they hold on the team. Printed
 * straight through, the endpoint's per-binding rows would show one person
 * twice and turn a count of people into something else.
 */
export const membersByPerson = (rows: TeamMemberRow[]): (TeamMemberRow & { roles: string[] })[] => {
  const byUser = new Map<string, TeamMemberRow & { roles: string[] }>();
  for (const row of rows) {
    const key = row.userId ?? `${row.email ?? ""}|${row.name ?? ""}`;
    const seen = byUser.get(key);
    if (seen) {
      if (!seen.roles.includes(row.role)) seen.roles.push(row.role);
      continue;
    }
    byUser.set(key, { ...row, roles: [row.role] });
  }
  return Array.from(byUser.values());
};

/**
 * Team membership is a team-scoped role binding, which is why adding a member
 * takes the role they get on the team rather than just their id.
 */
export const listTeamMembersCommand = async (teamId: string): Promise<CommandResult | void> =>
  runManagement({
    action: "list team members",
    pending: `Fetching members of team "${teamId}"...`,
    run: () => new TeamsApiService().listMembers(teamId),
    succeed: (result) =>
      `Found ${counted({
        count: membersByPerson(result.data).length,
        singular: "member",
        plural: "members",
      })}`,
    table: (result) => {
      const members = membersByPerson(result.data);
      if (members.length === 0) {
        printEmpty({ what: "team members" });
        return;
      }
      console.log();
      formatTable({
        data: members.map((member) => ({
          "User ID": orDash(member.userId),
          Name: orDash(member.name),
          Email: orDash(member.email),
          Roles: member.roles.join(", "),
        })),
        headers: ["User ID", "Name", "Email", "Roles"],
        colorMap: { "User ID": chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });

/** One person to add to a team, with the role they get there (the platform defaults to MEMBER). */
export type TeamMemberToAdd = { userId: string; role?: ManagementRole | undefined };

/** What a bulk add did: who was added, and who was not and why. */
export type TeamMembersAdded = {
  teamId: string;
  added: { userId: string; role: ManagementRole | null }[];
  failed: { userId: string; code: string; message: string }[];
};

/**
 * Adds every member, one request each, and keeps going past a refusal so one
 * bad id does not leave the rest of the team unbuilt. The refusals come back
 * by user, for the command to report.
 */
export const addMembersToTeam = async ({
  service,
  teamId,
  members,
}: {
  service: TeamsApiService;
  teamId: string;
  members: readonly TeamMemberToAdd[];
}): Promise<TeamMembersAdded> => {
  const result: TeamMembersAdded = { teamId, added: [], failed: [] };
  for (const member of members) {
    try {
      await service.addMember({
        teamId,
        input: { userId: member.userId, ...(member.role ? { role: member.role } : {}) },
      });
      result.added.push({ userId: member.userId, role: member.role ?? null });
    } catch (error) {
      const refusal = readCommandError(error);
      result.failed.push({ userId: member.userId, code: refusal.code, message: refusal.message });
    }
  }
  return result;
};

/**
 * Thrown after a bulk add that left some people out: the ones added stay
 * added, and the command fails naming the rest, so a script sees a non-zero
 * exit and the person reading it sees who to retry.
 */
export class TeamMembersNotAddedError extends Error {
  constructor(readonly result: TeamMembersAdded) {
    super(
      `${counted({ count: result.failed.length, singular: "user was", plural: "users were" })} not added to team "${result.teamId}": ${result.failed
        .map((failure) => `${failure.userId} (${failure.code}: ${failure.message})`)
        .join(
          "; ",
        )}. ${counted({ count: result.added.length, singular: "user was", plural: "users were" })} added.`,
    );
    this.name = "TeamMembersNotAddedError";
  }
}

export const printMembersAdded = (result: TeamMembersAdded): void => {
  console.log();
  if (result.added.length > 0) {
    formatTable({
      data: result.added.map((member) => ({
        "User ID": member.userId,
        Role: member.role ?? "MEMBER",
      })),
      headers: ["User ID", "Role"],
      colorMap: { "User ID": chalk.gray },
    });
    console.log();
  }
  console.log(
    chalk.gray(
      "Each member holds a team-scoped binding on this team. Read them back with `langwatch teams members list`.",
    ),
  );
  console.log();
};

/**
 * `langwatch teams members add <teamId> <userId...>`: one or several people,
 * all with the same role.
 */
export const addTeamMembersCommand = async ({
  teamId,
  userIds,
  options = {},
}: {
  teamId: string;
  userIds: readonly string[];
  options?: { role?: string };
}): Promise<CommandResult | void> => {
  const role = withParsedFlags(() =>
    options.role !== undefined ? parseRole(options.role) : undefined,
  );
  const who =
    userIds.length === 1
      ? `member "${userIds[0]}"`
      : counted({ count: userIds.length, singular: "member", plural: "members" });

  return runManagement({
    action: userIds.length === 1 ? "add team member" : "add team members",
    pending: `Adding ${who} to team "${teamId}"...`,
    run: async () => {
      const result = await addMembersToTeam({
        service: new TeamsApiService(),
        teamId,
        members: userIds.map((userId) => ({ userId, role })),
      });
      if (result.failed.length > 0) throw new TeamMembersNotAddedError(result);
      return result;
    },
    succeed: () => `Added ${who} to team "${teamId}"${role ? ` as ${chalk.cyan(role)}` : ""}`,
    table: printMembersAdded,
  });
};

export const removeTeamMemberCommand = async ({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}): Promise<CommandResult | void> =>
  runManagement({
    action: "remove team member",
    pending: `Removing member "${userId}" from team "${teamId}"...`,
    run: () => new TeamsApiService().removeMember({ teamId, userId }),
    succeed: () => `Removed member "${userId}" from team "${teamId}"`,
    table: () => {
      console.log();
      console.log(chalk.gray("The member no longer has access through this team."));
      console.log();
    },
  });

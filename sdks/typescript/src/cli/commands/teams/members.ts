import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
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
 * One row per person, listing every role they hold on the team.
 *
 * The endpoint answers with the team's bindings, and somebody may hold more
 * than one role at the same scope: their permissions are the union of all of
 * them. Printed straight through, that reads as the same person joining the
 * team twice, and a count of people that is not a count of people.
 */
const membersByPerson = (rows: TeamMemberRow[]): Array<TeamMemberRow & { roles: string[] }> => {
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

export const addTeamMemberCommand = async ({
  teamId,
  userId,
  options = {},
}: {
  teamId: string;
  userId: string;
  options?: { role?: string };
}): Promise<CommandResult | void> => {
  const role = withParsedFlags(() =>
    options.role !== undefined ? parseRole(options.role) : undefined,
  );

  return runManagement({
    action: "add team member",
    pending: `Adding member "${userId}" to team "${teamId}"...`,
    run: () =>
      new TeamsApiService().addMember({
        teamId,
        input: { userId, ...(role !== undefined ? { role } : {}) },
      }),
    succeed: () =>
      `Added member "${userId}" to team "${teamId}"${role ? ` as ${chalk.cyan(role)}` : ""}`,
    table: () => {
      console.log();
      console.log(
        chalk.gray(
          "The member now holds a team-scoped binding on this team. Read it back with `langwatch teams members list`.",
        ),
      );
      console.log();
    },
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

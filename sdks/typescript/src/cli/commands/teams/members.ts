import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
import { formatTable } from "../../utils/formatting";
import { parseRole } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  counted,
  orDash,
  printEmpty,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

/**
 * Team membership is a team-scoped role binding, which is why adding a member
 * takes the role they get on the team rather than just their id.
 */
export const listTeamMembersCommand = async (
  teamId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "list team members",
    pending: `Fetching members of team "${teamId}"...`,
    run: () => new TeamsApiService().listMembers(teamId),
    succeed: (result) =>
      `Found ${counted(result.data.length, "member", "members")}`,
    table: (result) => {
      if (result.data.length === 0) {
        printEmpty({ what: "team members" });
        return;
      }
      console.log();
      formatTable({
        data: result.data.map((member) => ({
          "User ID": orDash(member.userId),
          Name: orDash(member.name),
          Email: orDash(member.email),
          Role: member.role,
        })),
        headers: ["User ID", "Name", "Email", "Role"],
        colorMap: { "User ID": chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });

export const addTeamMemberCommand = async (
  teamId: string,
  userId: string,
  options: { role?: string } = {},
): Promise<CommandResult | void> => {
  const role = withParsedFlags(() =>
    options.role !== undefined ? parseRole(options.role) : undefined,
  );

  return runManagement({
    action: "add team member",
    pending: `Adding member "${userId}" to team "${teamId}"...`,
    run: async () => ({
      teamId,
      userId,
      ...(await new TeamsApiService().addMember(teamId, {
        userId,
        ...(role !== undefined ? { role } : {}),
      })),
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

export const removeTeamMemberCommand = async (
  teamId: string,
  userId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "remove team member",
    pending: `Removing member "${userId}" from team "${teamId}"...`,
    run: async () => ({
      teamId,
      userId,
      ...(await new TeamsApiService().removeMember(teamId, userId)),
    }),
    succeed: () => `Removed member "${userId}" from team "${teamId}"`,
    table: () => {
      console.log();
      console.log(chalk.gray("The member no longer has access through this team."));
      console.log();
    },
  });

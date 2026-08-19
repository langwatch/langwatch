import chalk from "chalk";
import { OrganizationApiService } from "@/client-sdk/services/organization/organization-api.service";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { orDash, printFacts, runManagement } from "../management/_shared";

/**
 * Read one member, including the teams they reach through team-scoped
 * bindings. Personal workspaces are not listed: they are not access an
 * administrator manages.
 */
export const getMemberCommand = async (
  userId: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch member",
    pending: `Fetching member "${userId}"...`,
    run: () => new OrganizationApiService().getMember(userId),
    succeed: (member) =>
      `Member "${chalk.cyan(member.user.name ?? member.user.email ?? member.userId)}"`,
    table: (member) => {
      printFacts([
        ["User ID", chalk.gray(member.userId)],
        ["Name", orDash(member.user.name)],
        ["Email", orDash(member.user.email)],
        ["Organization role", member.role],
        [
          "Status",
          member.disabled ? chalk.yellow("disabled") : chalk.green("active"),
        ],
        ["Teams", String(member.teams.length)],
      ]);
      if (member.teams.length === 0) return;
      formatTable({
        data: member.teams.map((team) => ({
          "Team ID": team.teamId,
          Team: team.teamName,
          Role: team.role,
          "Custom role": orDash(team.customRoleName),
        })),
        headers: ["Team ID", "Team", "Role", "Custom role"],
        colorMap: { "Team ID": chalk.gray, Team: chalk.cyan },
      });
      console.log();
    },
  });

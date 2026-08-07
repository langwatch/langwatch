import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
import type { CommandResult } from "../../utils/output";
import { printFacts, runManagement } from "../management/_shared";

export const updateTeamCommand = async (
  id: string,
  options: { name: string },
): Promise<CommandResult | void> =>
  runManagement({
    action: "update team",
    pending: `Updating team "${id}"...`,
    run: () => new TeamsApiService().update(id, { name: options.name }),
    succeed: (team) => `Updated team "${chalk.cyan(team.name)}"`,
    table: (team) => {
      printFacts([
        ["ID", chalk.gray(team.id)],
        ["Name", chalk.cyan(team.name)],
        ["Slug", team.slug],
      ]);
    },
  });

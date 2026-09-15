import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
import type { CommandResult } from "../../utils/output";
import { printFacts, runManagement } from "../management/_shared";

export const createTeamCommand = async (options: { name: string }): Promise<CommandResult | void> =>
  runManagement({
    action: "create team",
    pending: `Creating team "${options.name}"...`,
    run: () => new TeamsApiService().create({ name: options.name }),
    succeed: (team) => `Created team "${chalk.cyan(team.name)}"`,
    table: (team) => {
      printFacts([
        ["ID", chalk.gray(team.id)],
        ["Name", chalk.cyan(team.name)],
        ["Slug", team.slug],
      ]);
    },
  });

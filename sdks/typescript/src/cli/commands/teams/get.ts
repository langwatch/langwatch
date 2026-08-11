import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
import type { CommandResult } from "../../utils/output";
import { asDate, printFacts, runManagement } from "../management/_shared";

export const getTeamCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "fetch team",
    pending: `Fetching team "${id}"...`,
    run: () => new TeamsApiService().get(id),
    succeed: (team) => `Team "${chalk.cyan(team.name)}"`,
    table: (team) => {
      printFacts([
        ["ID", chalk.gray(team.id)],
        ["Name", chalk.cyan(team.name)],
        ["Slug", team.slug],
        ["Organization", team.organizationId],
        ["Created", asDate(team.createdAt)],
      ]);
    },
  });

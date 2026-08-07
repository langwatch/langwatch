import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
import type { CommandResult } from "../../utils/output";
import { printFacts, runManagement } from "../management/_shared";

/** Archive a team. Soft-delete: the team stops being listed, nothing is lost. */
export const archiveTeamCommand = async (
  id: string,
): Promise<CommandResult | void> =>
  runManagement({
    action: "archive team",
    pending: `Archiving team "${id}"...`,
    run: () => new TeamsApiService().archive(id),
    succeed: (team) => `Archived team "${chalk.cyan(team.name)}"`,
    table: (team) => {
      printFacts([
        ["ID", chalk.gray(team.id)],
        ["Name", chalk.cyan(team.name)],
        [
          "Archived",
          team.archivedAt ? new Date(team.archivedAt).toLocaleString() : "—",
        ],
      ]);
    },
  });

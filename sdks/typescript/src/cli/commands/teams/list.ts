import chalk from "chalk";
import { TeamsApiService } from "@/client-sdk/services/teams/teams-api.service";
import { formatTable } from "../../utils/formatting";
import { parseCount } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import {
  asDate,
  counted,
  printEmpty,
  runManagement,
  withParsedFlags,
} from "../management/_shared";

export const listTeamsCommand = async (
  options: { page?: string; limit?: string } = {},
): Promise<CommandResult | void> => {
  const query = withParsedFlags(() => ({
    ...(options.page !== undefined
      ? { page: parseCount(options.page, "--page") }
      : {}),
    ...(options.limit !== undefined
      ? { limit: parseCount(options.limit, "--limit") }
      : {}),
  }));

  return runManagement({
    action: "list teams",
    pending: "Fetching teams...",
    run: () => new TeamsApiService().list(query),
    succeed: (result) =>
      `Found ${counted({ count: result.pagination.total, singular: "team", plural: "teams" })}`,
    table: (result) => {
      if (result.data.length === 0) {
        printEmpty({
          what: "teams",
          hint: 'langwatch teams create --name "Platform"',
        });
        return;
      }
      console.log();
      formatTable({
        data: result.data.map((team) => ({
          ID: team.id,
          Name: team.name,
          Slug: team.slug,
          Created: asDate(team.createdAt),
        })),
        headers: ["ID", "Name", "Slug", "Created"],
        colorMap: { ID: chalk.gray, Name: chalk.cyan },
      });
      console.log();
    },
  });
};

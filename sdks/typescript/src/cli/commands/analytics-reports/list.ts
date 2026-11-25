import chalk from "chalk";

import { AnalyticsReportsApiService } from "@/client-sdk/services/analytics-reports/analytics-reports-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form, byte-identical to what this command printed before.
 */
export const listAnalyticsReportsCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new AnalyticsReportsApiService();
  const spinner = createSpinner("Fetching analytics reports...").start();

  try {
    const result = await service.list();
    const reports = result.data;

    spinner.succeed(`Found ${reports.length} analytics report${reports.length !== 1 ? "s" : ""}`);

    return {
      data: result,
      table: () => {
        if (reports.length === 0) {
          console.log();
          console.log(chalk.gray("No analytics reports found."));
          console.log(chalk.gray("Create one with:"));
          console.log(chalk.cyan('  langwatch analytics-report create "My Report"'));
          return;
        }

        console.log();

        const tableData = reports.map((d) => ({
          Name: d.name,
          ID: d.id,
          Graphs: String(d.graphCount),
          Updated: formatRelativeTime(d.updatedAt),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Graphs", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch analytics-report get <id>")} to view a report's details`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch analytics reports" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const listChartsCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new ChartsApiService();
  const spinner = createSpinner("Fetching charts...").start();

  try {
    const result = await service.list();
    const charts = result.data;

    spinner.succeed(
      `Found ${charts.length} chart${charts.length !== 1 ? "s" : ""}`,
    );

    return {
      data: result,
      table: () => {
        if (charts.length === 0) {
          console.log();
          console.log(chalk.gray("No saved charts found."));
          console.log(chalk.gray("Create one with:"));
          console.log(
            chalk.cyan(
              '  langwatch chart create --name "My Chart" --sql-file query.sql',
            ),
          );
          return;
        }

        console.log();

        const tableData = charts.map((c) => ({
          Name: c.name,
          ID: c.id,
          Dashboard: c.dashboardId ?? "-",
          Updated: formatRelativeTime(c.updatedAt),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Dashboard", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch chart get <id>")} to view chart details`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch charts" });
    process.exit(1);
  }
};

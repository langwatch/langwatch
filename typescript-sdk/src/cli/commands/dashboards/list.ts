import chalk from "chalk";
import ora from "ora";
import {
  DashboardsApiService,
  DashboardsApiError,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listDashboardsCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new DashboardsApiService();
  const spinner = ora("Fetching dashboards...").start();

  try {
    const result = await service.list();
    const dashboards = result.data;

    spinner.succeed(
      `Found ${dashboards.length} dashboard${dashboards.length !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (dashboards.length === 0) {
      console.log();
      console.log(chalk.gray("No dashboards found."));
      console.log(chalk.gray("Create one with:"));
      console.log(chalk.cyan('  langwatch dashboard create "My Dashboard"'));
      return;
    }

    console.log();

    const tableData = dashboards.map((d) => ({
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
        `Use ${chalk.cyan("langwatch dashboard get <id>")} to view dashboard details`,
      ),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboards" });
    process.exit(1);
  }
};

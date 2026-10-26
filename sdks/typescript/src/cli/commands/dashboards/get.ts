import chalk from "chalk";

import {
  DashboardWidgetsApiError,
  DashboardWidgetsApiService,
} from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import {
  DashboardsApiError,
  DashboardsApiService,
} from "@/client-sdk/services/dashboards/dashboards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

const isNotFound = (error: unknown): boolean =>
  (error instanceof DashboardsApiError && error.status === 404) ||
  (error instanceof DashboardWidgetsApiError && error.status === 404) ||
  (error instanceof Error && "httpStatus" in error && error.httpStatus === 404);

/**
 * Returns the dashboard rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getDashboardCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new DashboardsApiService();
  const spinner = createSpinner(`Fetching dashboard "${id}"...`).start();

  try {
    const dashboard = await service.get(id).catch(async (error: unknown) => {
      // The Reports API never holds a Dashboards board, so its 404 is not final.
      if (!isNotFound(error)) throw error;
      try {
        return { ...(await new DashboardWidgetsApiService().getBoard(id)), graphs: [] };
      } catch (boardError) {
        // Only the board route's own 404 means "neither area holds it".
        throw isNotFound(boardError) ? error : boardError;
      }
    });

    spinner.succeed(`Found dashboard "${dashboard.name}"`);

    return {
      data: dashboard,
      table: () => {
        console.log();
        console.log(chalk.bold("  Dashboard Details:"));
        console.log(`    ${chalk.gray("ID:")}      ${chalk.green(dashboard.id)}`);
        console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(dashboard.name)}`);
        console.log(
          `    ${chalk.gray("Graphs:")}  ${Array.isArray(dashboard.graphs) ? dashboard.graphs.length : 0}`,
        );
        console.log(
          `    ${chalk.gray("Created:")} ${new Date(dashboard.createdAt).toLocaleString()}`,
        );
        console.log(
          `    ${chalk.gray("Updated:")} ${new Date(dashboard.updatedAt).toLocaleString()}`,
        );
        if (dashboard.platformUrl) {
          console.log(`    ${chalk.bold("View:")}   ${chalk.underline(dashboard.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboard" });
    process.exit(1);
  }
};

import chalk from "chalk";

import {
  DashboardWidgetsApiService,
  type DashboardListItem as ProjectPathDashboard,
} from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import {
  DashboardsApiError,
  DashboardsApiService,
  type DashboardListItem,
} from "@/client-sdk/services/dashboards/dashboards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

const isNotFound = (error: unknown): boolean =>
  (error instanceof DashboardsApiError && error.status === 404) ||
  (error instanceof Error && "httpStatus" in error && error.httpStatus === 404);

/**
 * /api/v1/dashboards first; it answers 404 while Dashboards is off (or on a server without it),
 * and only then the project-path list, which answers either way.
 */
async function listDashboards(): Promise<{ data: (DashboardListItem | ProjectPathDashboard)[] }> {
  try {
    return await new DashboardsApiService().list();
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return new DashboardWidgetsApiService().listDashboards();
  }
}

/**
 * The dashboards a widget can be pinned to; `langwatch analytics-reports list` lists the
 * Analytics Reports, which hold no widget.
 */
export const listDashboardWidgetDashboardsCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const spinner = createSpinner("Fetching dashboards...").start();

  try {
    const result = await listDashboards();
    const dashboards = result.data;

    spinner.succeed(`Found ${dashboards.length} dashboard${dashboards.length !== 1 ? "s" : ""}`);

    return {
      data: result,
      table: () => {
        console.log();
        if (dashboards.length === 0) {
          console.log(chalk.gray("No dashboards found. Create one in the Dashboards area first."));
          return;
        }

        formatTable({
          data: dashboards.map((dashboard) => ({
            Name: sanitizeTerminalText(dashboard.name),
            ID: dashboard.id,
            Widgets: String(dashboard.widgetCount),
          })),
          headers: ["Name", "ID", "Widgets"],
          colorMap: { Name: chalk.cyan, ID: chalk.green },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch dashboard-widget pin <widget> --dashboard <id>")} to add a widget`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboards" });
    process.exit(1);
  }
};

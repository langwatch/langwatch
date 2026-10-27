import chalk from "chalk";

import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatRelativeTime, formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * `langwatch dashboards`: the dashboards of the key's project, over /api/v1/dashboards. Each
 * command returns its result for the output port to render (utils/output.ts).
 */
export const listDashboardsCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner("Fetching dashboards...").start();

  try {
    const result = await new DashboardsApiService().list();
    const dashboards = result.data;
    spinner.succeed(`Found ${dashboards.length} dashboard${dashboards.length === 1 ? "" : "s"}`);

    return {
      data: result,
      table: () => {
        console.log();
        if (dashboards.length === 0) {
          console.log(chalk.gray("No dashboards found. Create one with:"));
          console.log(chalk.cyan('  langwatch dashboards create "Usage"'));
          return;
        }
        formatTable({
          data: dashboards.map((dashboard) => ({
            Name: sanitizeTerminalText(dashboard.name),
            ID: dashboard.id,
            Widgets: String(dashboard.widgetCount),
            Updated: formatRelativeTime(dashboard.updatedAt),
          })),
          headers: ["Name", "ID", "Widgets", "Updated"],
          colorMap: { Name: chalk.cyan, ID: chalk.green },
        });
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboards" });
    process.exit(1);
  }
};

export const getDashboardCommand = async (dashboardId: string): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Fetching dashboard "${dashboardId}"...`).start();

  try {
    const dashboard = await new DashboardsApiService().get(dashboardId);
    spinner.succeed(`Found dashboard "${chalk.cyan(sanitizeTerminalText(dashboard.name))}"`);

    return {
      data: dashboard,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}    ${chalk.green(dashboard.id)}`);
        console.log(
          `  ${chalk.gray("Name:")}  ${chalk.cyan(sanitizeTerminalText(dashboard.name))}`,
        );
        console.log(`  ${chalk.gray("Scope:")} ${dashboard.scope}`);
        if (dashboard.platformUrl) {
          console.log(`  ${chalk.gray("View:")}  ${chalk.underline(dashboard.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboard" });
    process.exit(1);
  }
};

export const createDashboardCommand = async (name: string): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Creating dashboard "${name}"...`).start();

  try {
    const dashboard = await new DashboardsApiService().create({ name });
    spinner.succeed(
      `Created dashboard "${chalk.cyan(sanitizeTerminalText(dashboard.name))}" ${chalk.gray(`(id: ${dashboard.id})`)}`,
    );

    return {
      data: dashboard,
      table: () => {
        if (dashboard.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(dashboard.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create dashboard" });
    process.exit(1);
  }
};

/** A call naming nothing is refused locally, matching the API's own refusal. */
export const updateDashboardCommand = async (
  dashboardId: string,
  options: { name?: string; description?: string; clearDescription?: boolean },
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const description = options.clearDescription ? null : options.description;
  if (options.name === undefined && description === undefined) {
    console.error(
      chalk.red("Error: nothing to update — pass --name, --description or --clear-description"),
    );
    process.exit(1);
  }
  const spinner = createSpinner(`Updating dashboard "${dashboardId}"...`).start();

  try {
    const dashboard = await new DashboardsApiService().update({
      dashboardId,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(description === undefined ? {} : { description }),
    });
    spinner.succeed(`Updated dashboard "${chalk.cyan(sanitizeTerminalText(dashboard.name))}"`);

    return { data: dashboard, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "update dashboard" });
    process.exit(1);
  }
};

export const deleteDashboardCommand = async (
  dashboardId: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Deleting dashboard "${dashboardId}"...`).start();

  try {
    const result = await new DashboardsApiService().delete(dashboardId);
    spinner.succeed(
      `Deleted dashboard "${chalk.cyan(sanitizeTerminalText(result.name))}" ${chalk.gray(`(id: ${result.id})`)}`,
    );

    return { data: result, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete dashboard" });
    process.exit(1);
  }
};

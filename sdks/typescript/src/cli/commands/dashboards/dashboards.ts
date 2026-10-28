import chalk from "chalk";

import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatRelativeTime, formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * `langwatch dashboard`: the dashboards of the key's project, over /api/v1/dashboards. Each
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
          console.log(chalk.cyan('  langwatch dashboard create "Usage"'));
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
        console.log(
          `  ${chalk.gray("Langy traces:")} ${describeLangyTraces(dashboard.excludedOrigins)}`,
        );
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

const LANGY_ORIGIN = "langy";

/** The stored origins a dashboard leaves out, in words; null is the project default. */
export function describeLangyTraces(excludedOrigins: string[] | null | undefined): string {
  if (excludedOrigins == null) return "default (left out, included in a personal project)";
  if (excludedOrigins.length === 0) return "included";
  const others = excludedOrigins.filter((origin) => origin !== LANGY_ORIGIN);
  const langy = excludedOrigins.includes(LANGY_ORIGIN) ? "left out" : "included";
  return others.length === 0 ? langy : `${langy}; also leaves out ${others.join(", ")}`;
}

/** The `excludedOrigins` value the Langy traces flags send; undefined sends nothing. */
function langyTracesSetting(options: {
  includeLangyTraces?: boolean;
  excludeLangyTraces?: boolean;
  resetLangyTraces?: boolean;
}): string[] | null | undefined {
  if (options.includeLangyTraces) return [];
  if (options.excludeLangyTraces) return [LANGY_ORIGIN];
  if (options.resetLangyTraces) return null;
  return undefined;
}

/** A call naming nothing is refused locally, matching the API's own refusal. */
export const updateDashboardCommand = async (
  dashboardId: string,
  options: {
    name?: string;
    description?: string;
    clearDescription?: boolean;
    includeLangyTraces?: boolean;
    excludeLangyTraces?: boolean;
    resetLangyTraces?: boolean;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const description = options.clearDescription ? null : options.description;
  const excludedOrigins = langyTracesSetting(options);
  if (options.name === undefined && description === undefined && excludedOrigins === undefined) {
    console.error(
      chalk.red(
        "Error: nothing to update — pass --name, --description, --clear-description, --include-langy-traces, --exclude-langy-traces or --reset-langy-traces",
      ),
    );
    process.exit(1);
  }
  const spinner = createSpinner(`Updating dashboard "${dashboardId}"...`).start();

  try {
    const dashboard = await new DashboardsApiService().update({
      dashboardId,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(description === undefined ? {} : { description }),
      ...(excludedOrigins === undefined ? {} : { excludedOrigins }),
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

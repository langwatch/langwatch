import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import {
  DashboardsApiService,
  type DashboardSummary,
} from "@/client-sdk/services/dashboards/dashboards-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Resolves a widget reference (id or name) to the widget it names.
 *
 * Tries it as an id first — the common case, and the cheapest — then falls
 * back to a name match across the project's widgets.
 */
async function resolveWidgetRef(
  widgets: DashboardWidgetsApiService,
  ref: string,
) {
  try {
    return await widgets.get(ref);
  } catch {
    // Not an id (or not found by id) — fall back to a name match.
  }

  const { data } = await widgets.list();
  const matches = data.filter((w) => w.name === ref);
  if (matches.length === 0) {
    throw new Error(`No widget named "${ref}"`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple widgets named "${ref}" — pass the id`);
  }
  return matches[0]!;
}

/** Resolves a dashboard reference (id or name) to the dashboard it names. */
async function resolveDashboardRef(
  dashboards: DashboardsApiService,
  ref: string,
): Promise<DashboardSummary> {
  const { data } = await dashboards.list();
  const byId = data.find((d) => d.id === ref);
  if (byId) return byId;

  const matches = data.filter((d) => d.name === ref);
  if (matches.length === 0) {
    throw new Error(`No dashboard named "${ref}"`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple dashboards named "${ref}" — pass the id`);
  }
  return matches[0]!;
}

/**
 * Returns the pinned widget rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const pinDashboardWidgetCommand = async (
  widgetRef: string,
  options: { dashboard?: string; project?: string },
): Promise<CommandResult | void> => {
  if (!options.dashboard) {
    console.error(chalk.red("Error: --dashboard is required"));
    process.exit(1);
  }

  await resolveCredentials({ project: options.project });

  const widgets = new DashboardWidgetsApiService();
  const dashboards = new DashboardsApiService();
  const spinner = createSpinner(`Adding "${widgetRef}" to dashboard...`).start();

  try {
    const widgetBefore = await resolveWidgetRef(widgets, widgetRef);
    const dashboard = await resolveDashboardRef(dashboards, options.dashboard);

    const widget = await widgets.assignDashboard(widgetBefore.id, {
      dashboardId: dashboard.id,
    });

    spinner.succeed(
      `Added "${widget.name}" to dashboard "${dashboard.name}"`,
    );

    return {
      data: { widget, dashboard },
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("Widget:")}    ${chalk.cyan(widget.name)}`);
        console.log(`  ${chalk.gray("Dashboard:")} ${chalk.cyan(dashboard.name)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "pin dashboard widget" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

const parseGridFlag = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(chalk.red(`Error: ${name} must be a whole number`));
    process.exit(1);
  }
  return value;
};

/**
 * Returns the placed widget rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts). The twin of
 * `placeChartCommand`, on the widget's own 8-column grid. With no grid row
 * given, the platform allocates the next free row on that dashboard,
 * counting cards of every kind.
 */
export const placeDashboardWidgetCommand = async (
  id: string,
  options: {
    dashboardId?: string;
    gridColumn?: string;
    gridRow?: string;
    colSpan?: string;
    rowSpan?: string;
    project?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  if (!options.dashboardId) {
    console.error(chalk.red("Error: --dashboard-id is required"));
    process.exit(1);
  }

  const gridColumn = parseGridFlag("--grid-column", options.gridColumn);
  const gridRow = parseGridFlag("--grid-row", options.gridRow);
  const colSpan = parseGridFlag("--col-span", options.colSpan);
  const rowSpan = parseGridFlag("--row-span", options.rowSpan);

  const widgets = new DashboardWidgetsApiService();
  const spinner = createSpinner(
    `Placing widget "${id}" on dashboard "${options.dashboardId}"...`,
  ).start();

  try {
    const widget = await widgets.place(id, {
      dashboardId: options.dashboardId,
      ...(gridColumn === undefined ? {} : { gridColumn }),
      ...(gridRow === undefined ? {} : { gridRow }),
      ...(colSpan === undefined ? {} : { colSpan }),
      ...(rowSpan === undefined ? {} : { rowSpan }),
    });

    spinner.succeed(
      `Placed "${chalk.cyan(widget.name)}" on dashboard ${chalk.green(widget.dashboardId ?? options.dashboardId)}`,
    );

    return {
      data: widget,
      table: () => {
        console.log();
        console.log(
          `  ${chalk.gray("Grid:")} column ${widget.gridColumn}, row ${widget.gridRow}, spans ${widget.colSpan}x${widget.rowSpan}`,
        );
        if (widget.platformUrl) {
          console.log(
            `  ${chalk.bold("View:")} ${chalk.underline(widget.platformUrl)}`,
          );
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "place dashboard widget" });
    process.exit(1);
  }
};

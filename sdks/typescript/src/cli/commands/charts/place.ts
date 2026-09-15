import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
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
 * Returns the placed chart rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts). With no grid
 * row given, the platform allocates the next free row on that dashboard,
 * counting charts of every kind.
 */
export const placeChartCommand = async (
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

  const service = new ChartsApiService();
  const spinner = createSpinner(
    `Placing chart "${id}" on dashboard "${options.dashboardId}"...`,
  ).start();

  try {
    const chart = await service.place(id, {
      dashboardId: options.dashboardId,
      ...(gridColumn === undefined ? {} : { gridColumn }),
      ...(gridRow === undefined ? {} : { gridRow }),
      ...(colSpan === undefined ? {} : { colSpan }),
      ...(rowSpan === undefined ? {} : { rowSpan }),
    });

    spinner.succeed(
      `Placed chart "${chalk.cyan(chart.name)}" on dashboard ${chalk.green(chart.dashboardId ?? options.dashboardId)}`,
    );

    return {
      data: chart,
      table: () => {
        console.log();
        console.log(
          `  ${chalk.gray("Grid:")} column ${chart.gridColumn}, row ${chart.gridRow}, spans ${chart.colSpan}x${chart.rowSpan}`,
        );
        if (chart.platformUrl) {
          console.log(`  ${chalk.bold("View:")} ${chalk.underline(chart.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "place chart" });
    process.exit(1);
  }
};

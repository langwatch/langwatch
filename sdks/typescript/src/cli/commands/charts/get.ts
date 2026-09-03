import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the chart rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getChartCommand = async (
  id: string,
  options?: { project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new ChartsApiService();
  const spinner = createSpinner(`Fetching chart "${id}"...`).start();

  try {
    const chart = await service.get(id);

    spinner.succeed(`Found chart "${chart.name}"`);

    return {
      data: chart,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}        ${chalk.green(chart.id)}`);
        console.log(`  ${chalk.gray("Name:")}      ${chalk.cyan(chart.name)}`);
        console.log(
          `  ${chalk.gray("Dashboard:")} ${chart.dashboardId ? chalk.cyan(chart.dashboardId) : chalk.gray("not placed")}`,
        );
        if (chart.dashboardId) {
          console.log(
            `  ${chalk.gray("Grid:")}      column ${chart.gridColumn}, row ${chart.gridRow}, spans ${chart.colSpan}x${chart.rowSpan}`,
          );
        }
        console.log();
        console.log(`  ${chalk.gray("SQL:")}`);
        for (const line of chart.definition.sql.split("\n")) {
          console.log(`    ${line}`);
        }
        const parameterNames = Object.keys(chart.definition.parameters);
        if (parameterNames.length > 0) {
          console.log();
          console.log(`  ${chalk.gray("Parameters:")}`);
          for (const name of parameterNames) {
            console.log(
              `    ${chalk.cyan(name)} = ${JSON.stringify(chart.definition.parameters[name])}`,
            );
          }
        }
        if (chart.platformUrl) {
          console.log();
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(chart.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch chart" });
    process.exit(1);
  }
};

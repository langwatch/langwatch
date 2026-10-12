import chalk from "chalk";

import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { ChartInputError, type DefinitionFlags, resolveDefinitionInput } from "./definitionInput";

/**
 * Returns the updated chart rather than printing it (output port renders
 * per-format). A call touching nothing is refused locally, matching the
 * API's own refusal of an empty update.
 */
export const updateChartCommand = async (
  id: string,
  options: DefinitionFlags & { name?: string; project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  let definition;
  try {
    definition = resolveDefinitionInput(options);
  } catch (error) {
    if (error instanceof ChartInputError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  if (options.name === undefined && definition === undefined) {
    console.error(
      chalk.red("Error: nothing to update — pass --name, or a definition via --sql / --sql-file"),
    );
    process.exit(1);
  }

  const service = new ChartsApiService();
  const spinner = createSpinner(`Updating chart "${id}"...`).start();

  try {
    const chart = await service.update(id, {
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(definition === undefined ? {} : { definition }),
    });

    spinner.succeed(`Updated chart "${chart.name}"`);

    return {
      data: chart,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(chart.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(chart.name)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update chart" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  ChartInputError,
  type DefinitionFlags,
  resolveDefinitionInput,
} from "./definitionInput";

/**
 * Returns the created chart rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const createChartCommand = async (
  options: DefinitionFlags & { name?: string; project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

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
  if (!definition) {
    console.error(
      chalk.red("Error: a chart needs its statement — pass --sql or --sql-file"),
    );
    process.exit(1);
  }

  const service = new ChartsApiService();
  const spinner = createSpinner(`Creating chart "${options.name}"...`).start();

  try {
    const chart = await service.create({ name: options.name, definition });

    spinner.succeed(
      `Created chart "${chalk.cyan(chart.name)}" ${chalk.gray(`(id: ${chart.id})`)}`,
    );

    return {
      data: chart,
      table: () => {
        if (chart.platformUrl) {
          console.log(
            `  ${chalk.bold("View:")}  ${chalk.underline(chart.platformUrl)}`,
          );
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create chart" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  WidgetInputError,
  type DefinitionFlags,
  resolveDefinitionInput,
} from "./definitionInput";

/**
 * Returns the created widget rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createDashboardWidgetCommand = async (
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
    if (error instanceof WidgetInputError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }
  if (!definition) {
    console.error(
      chalk.red(
        "Error: a widget needs its source and queries — pass --code / --code-file together with --queries-file",
      ),
    );
    process.exit(1);
  }

  const service = new DashboardWidgetsApiService();
  const spinner = createSpinner(`Creating widget "${options.name}"...`).start();

  try {
    const widget = await service.create({ name: options.name, definition });

    spinner.succeed(
      `Created widget "${chalk.cyan(widget.name)}" ${chalk.gray(`(id: ${widget.id})`)}`,
    );

    return {
      data: widget,
      table: () => {
        if (widget.platformUrl) {
          console.log(
            `  ${chalk.bold("View:")}  ${chalk.underline(widget.platformUrl)}`,
          );
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create dashboard widget" });
    process.exit(1);
  }
};

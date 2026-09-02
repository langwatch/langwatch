import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { PlaygroundWidgetsApiService } from "@/client-sdk/services/playground-widgets/playground-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  WidgetInputError,
  type DefinitionFlags,
  resolveDefinitionInput,
} from "./definitionInput";

/**
 * Returns the updated widget rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts). A
 * call touching nothing is refused locally, matching the API's own refusal
 * of an empty update.
 */
export const updatePlaygroundWidgetCommand = async (
  id: string,
  options: DefinitionFlags & { name?: string; project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

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

  if (options.name === undefined && definition === undefined) {
    console.error(
      chalk.red(
        "Error: nothing to update — pass --name, or a definition via --code / --code-file with --queries-file",
      ),
    );
    process.exit(1);
  }

  const service = new PlaygroundWidgetsApiService();
  const spinner = createSpinner(`Updating widget "${id}"...`).start();

  try {
    const widget = await service.update(id, {
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(definition === undefined ? {} : { definition }),
    });

    spinner.succeed(`Updated widget "${widget.name}"`);

    return {
      data: widget,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(widget.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(widget.name)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update playground widget" });
    process.exit(1);
  }
};

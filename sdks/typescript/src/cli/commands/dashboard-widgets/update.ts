import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import {
  WidgetInputError,
  type DefinitionFlags,
  resolveUpdateDefinitionInput,
} from "./definitionInput";

/**
 * Returns the updated widget rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts). A
 * call touching nothing is refused locally, matching the API's own refusal
 * of an empty update. Passing only `--code`/`--code-file` or only
 * `--queries-file` backfills the other half from the widget currently saved,
 * rather than refusing — the platform's own definition schema still needs
 * both, but the caller who only meant to change one need not resend the
 * other unchanged.
 */
export const updateDashboardWidgetCommand = async (
  id: string,
  options: DefinitionFlags & { name?: string; project?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  const service = new DashboardWidgetsApiService();
  const spinner = createSpinner(`Updating widget "${id}"...`).start();

  let definition;
  try {
    definition = await resolveUpdateDefinitionInput(options, async () => {
      const current = await service.get(id);
      return {
        code: current.definition.code,
        queries: current.definition.queries,
      };
    });
  } catch (error) {
    if (error instanceof WidgetInputError) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    failSpinner({ spinner, error, action: "update dashboard widget" });
    process.exit(1);
  }

  if (options.name === undefined && definition === undefined) {
    spinner.stop();
    console.error(
      chalk.red(
        "Error: nothing to update — pass --name, or a definition via --code / --code-file with --queries-file",
      ),
    );
    process.exit(1);
  }

  try {
    const widget = await service.update({
      id,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(definition === undefined ? {} : { definition }),
    });

    const safeName = sanitizeTerminalText(widget.name);
    spinner.succeed(`Updated widget "${safeName}"`);

    return {
      data: widget,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(widget.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(safeName)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update dashboard widget" });
    process.exit(1);
  }
};

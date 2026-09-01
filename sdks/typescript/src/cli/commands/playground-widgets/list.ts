import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { PlaygroundWidgetsApiService } from "@/client-sdk/services/playground-widgets/playground-widgets-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const listPlaygroundWidgetsCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new PlaygroundWidgetsApiService();
  const spinner = createSpinner("Fetching playground widgets...").start();

  try {
    const result = await service.list();
    const widgets = result.data;

    spinner.succeed(
      `Found ${widgets.length} widget${widgets.length !== 1 ? "s" : ""}`,
    );

    return {
      data: result,
      table: () => {
        if (widgets.length === 0) {
          console.log();
          console.log(chalk.gray("No playground widgets found."));
          console.log(chalk.gray("Create one with:"));
          console.log(
            chalk.cyan(
              '  langwatch playground-widget create --name "My Widget" --code-file widget.tsx --queries-file queries.json',
            ),
          );
          return;
        }

        console.log();

        const tableData = widgets.map((w) => ({
          Name: w.name,
          ID: w.id,
          Updated: formatRelativeTime(w.updatedAt),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch playground-widget get <id>")} to view widget details`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch playground widgets" });
    process.exit(1);
  }
};

import chalk from "chalk";

import { BoardsApiService } from "@/client-sdk/services/boards/boards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * The Dashboards boards a widget can be pinned to; `langwatch dashboard list` lists the
 * Analytics Reports boards, which hold no widget.
 */
export const listDashboardWidgetBoardsCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const service = new BoardsApiService();
  const spinner = createSpinner("Fetching dashboards...").start();

  try {
    const result = await service.list();
    const boards = result.data;

    spinner.succeed(`Found ${boards.length} dashboard${boards.length !== 1 ? "s" : ""}`);

    return {
      data: result,
      table: () => {
        console.log();
        if (boards.length === 0) {
          console.log(chalk.gray("No dashboards found. Create one in the Dashboards area first."));
          return;
        }

        formatTable({
          data: boards.map((board) => ({
            Name: sanitizeTerminalText(board.name),
            ID: board.id,
            Widgets: String(board.widgetCount),
          })),
          headers: ["Name", "ID", "Widgets"],
          colorMap: { Name: chalk.cyan, ID: chalk.green },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch dashboard-widget pin <widget> --dashboard <id>")} to add a widget`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch dashboards" });
    process.exit(1);
  }
};

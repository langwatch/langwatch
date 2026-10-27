import chalk from "chalk";

import {
  BoardsApiError,
  BoardsApiService,
  type BoardListItem,
} from "@/client-sdk/services/boards/boards-api.service";
import {
  DashboardWidgetsApiService,
  type DashboardListItem,
} from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

const isNotFound = (error: unknown): boolean =>
  (error instanceof BoardsApiError && error.status === 404) ||
  (error instanceof Error && "httpStatus" in error && error.httpStatus === 404);

/**
 * /api/v1/dashboards first; it answers 404 while Dashboards is off (or on a server without it),
 * and only then the project-path list, which answers either way.
 */
async function listBoards(): Promise<{ data: (BoardListItem | DashboardListItem)[] }> {
  try {
    return await new BoardsApiService().list();
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return new DashboardWidgetsApiService().listDashboards();
  }
}

/**
 * The Dashboards boards a widget can be pinned to; `langwatch dashboard list` lists the
 * Analytics Reports boards, which hold no widget.
 */
export const listDashboardWidgetBoardsCommand = async (options?: {
  project?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options?.project });

  const spinner = createSpinner("Fetching dashboards...").start();

  try {
    const result = await listBoards();
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

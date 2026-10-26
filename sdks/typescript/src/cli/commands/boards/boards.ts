import chalk from "chalk";

import { BoardsApiService } from "@/client-sdk/services/boards/boards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatRelativeTime, formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * `langwatch dashboards`: the Dashboards boards of the key's project, over /api/v1/dashboards. Each
 * command returns its result for the output port to render (utils/output.ts).
 */
export const listBoardsCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner("Fetching boards...").start();

  try {
    const result = await new BoardsApiService().list();
    const boards = result.data;
    spinner.succeed(`Found ${boards.length} board${boards.length === 1 ? "" : "s"}`);

    return {
      data: result,
      table: () => {
        console.log();
        if (boards.length === 0) {
          console.log(chalk.gray("No boards found. Create one with:"));
          console.log(chalk.cyan('  langwatch dashboards create "My board"'));
          return;
        }
        formatTable({
          data: boards.map((board) => ({
            Name: sanitizeTerminalText(board.name),
            ID: board.id,
            Widgets: String(board.widgetCount),
            Updated: formatRelativeTime(board.updatedAt),
          })),
          headers: ["Name", "ID", "Widgets", "Updated"],
          colorMap: { Name: chalk.cyan, ID: chalk.green },
        });
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch boards" });
    process.exit(1);
  }
};

export const getBoardCommand = async (boardId: string): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Fetching board "${boardId}"...`).start();

  try {
    const board = await new BoardsApiService().get(boardId);
    spinner.succeed(`Found board "${chalk.cyan(sanitizeTerminalText(board.name))}"`);

    return {
      data: board,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}    ${chalk.green(board.id)}`);
        console.log(`  ${chalk.gray("Name:")}  ${chalk.cyan(sanitizeTerminalText(board.name))}`);
        console.log(`  ${chalk.gray("Scope:")} ${board.scope}`);
        if (board.platformUrl) {
          console.log(`  ${chalk.gray("View:")}  ${chalk.underline(board.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch board" });
    process.exit(1);
  }
};

export const createBoardCommand = async (name: string): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Creating board "${name}"...`).start();

  try {
    const board = await new BoardsApiService().create({ name });
    spinner.succeed(
      `Created board "${chalk.cyan(sanitizeTerminalText(board.name))}" ${chalk.gray(`(id: ${board.id})`)}`,
    );

    return {
      data: board,
      table: () => {
        if (board.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(board.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create board" });
    process.exit(1);
  }
};

/** A call naming nothing is refused locally, matching the API's own refusal. */
export const updateBoardCommand = async (
  boardId: string,
  options: { name?: string; description?: string; clearDescription?: boolean },
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const description = options.clearDescription ? null : options.description;
  if (options.name === undefined && description === undefined) {
    console.error(
      chalk.red("Error: nothing to update — pass --name, --description or --clear-description"),
    );
    process.exit(1);
  }
  const spinner = createSpinner(`Updating board "${boardId}"...`).start();

  try {
    const board = await new BoardsApiService().update({
      boardId,
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(description === undefined ? {} : { description }),
    });
    spinner.succeed(`Updated board "${chalk.cyan(sanitizeTerminalText(board.name))}"`);

    return { data: board, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "update board" });
    process.exit(1);
  }
};

export const deleteBoardCommand = async (boardId: string): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Deleting board "${boardId}"...`).start();

  try {
    const result = await new BoardsApiService().delete(boardId);
    spinner.succeed(
      `Deleted board "${chalk.cyan(sanitizeTerminalText(result.name))}" ${chalk.gray(`(id: ${result.id})`)}`,
    );

    return { data: result, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete board" });
    process.exit(1);
  }
};

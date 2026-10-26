import chalk from "chalk";

import { BoardsApiService } from "@/client-sdk/services/boards/boards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import {
  type DefinitionFlags,
  resolveDefinitionInput,
  WidgetInputError,
} from "../dashboard-widgets/definitionInput";

/** The definition flags, resolved; a refusal ends the command before any request. */
const definitionOf = (flags: DefinitionFlags) => {
  try {
    return resolveDefinitionInput(flags);
  } catch (error) {
    if (error instanceof WidgetInputError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }
};

/** `langwatch boards widgets list <boardId>`: the widgets on one board. */
export const listBoardWidgetsCommand = async (boardId: string): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Fetching widgets on board "${boardId}"...`).start();

  try {
    const result = await new BoardsApiService().listWidgets(boardId);
    const widgets = result.data;
    spinner.succeed(`Found ${widgets.length} widget${widgets.length === 1 ? "" : "s"}`);

    return {
      data: result,
      table: () => {
        console.log();
        if (widgets.length === 0) {
          console.log(chalk.gray("No widgets on this board."));
          return;
        }
        formatTable({
          data: widgets.map((widget) => ({
            Name: sanitizeTerminalText(widget.name),
            ID: widget.id,
            Queries: String(widget.definition.queries.length),
          })),
          headers: ["Name", "ID", "Queries"],
          colorMap: { Name: chalk.cyan, ID: chalk.green },
        });
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch board widgets" });
    process.exit(1);
  }
};

export const getBoardWidgetCommand = async (
  boardId: string,
  widgetId: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Fetching widget "${widgetId}"...`).start();

  try {
    const widget = await new BoardsApiService().getWidget({ boardId, widgetId });
    spinner.succeed(`Found widget "${chalk.cyan(sanitizeTerminalText(widget.name))}"`);

    return {
      data: widget,
      table: () => {
        console.log();
        console.log(chalk.gray("// queries"));
        console.log(JSON.stringify(widget.definition.queries, null, 2));
        console.log(chalk.gray("// code"));
        console.log(widget.definition.code);
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch board widget" });
    process.exit(1);
  }
};

export const createBoardWidgetCommand = async (
  boardId: string,
  options: DefinitionFlags & { name?: string; description?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const definition = definitionOf(options);
  if (!options.name || !definition) {
    console.error(
      chalk.red(
        "Error: a widget needs --name, and its source and queries — --code / --code-file with --queries-file",
      ),
    );
    process.exit(1);
  }
  const spinner = createSpinner(`Creating widget "${options.name}"...`).start();

  try {
    const widget = await new BoardsApiService().createWidget({
      boardId,
      widget: {
        name: options.name,
        code: definition.code,
        queries: definition.queries,
        ...(options.description === undefined ? {} : { description: options.description }),
      },
    });
    spinner.succeed(
      `Created widget "${chalk.cyan(sanitizeTerminalText(widget.name))}" ${chalk.gray(`(id: ${widget.id})`)}`,
    );

    return { data: widget, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "create board widget" });
    process.exit(1);
  }
};

export const updateBoardWidgetCommand = async (
  boardId: string,
  widgetId: string,
  options: DefinitionFlags & { name?: string; description?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const definition = definitionOf(options);
  if (options.name === undefined && options.description === undefined && !definition) {
    console.error(
      chalk.red(
        "Error: nothing to update — pass --name, --description, or --code / --code-file with --queries-file",
      ),
    );
    process.exit(1);
  }
  const spinner = createSpinner(`Updating widget "${widgetId}"...`).start();

  try {
    const widget = await new BoardsApiService().updateWidget({
      boardId,
      widgetId,
      changes: {
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.description === undefined ? {} : { description: options.description }),
        ...definition,
      },
    });
    spinner.succeed(`Updated widget "${chalk.cyan(sanitizeTerminalText(widget.name))}"`);

    return { data: widget, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "update board widget" });
    process.exit(1);
  }
};

export const deleteBoardWidgetCommand = async (
  boardId: string,
  widgetId: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Deleting widget "${widgetId}"...`).start();

  try {
    await new BoardsApiService().deleteWidget({ boardId, widgetId });
    spinner.succeed(`Deleted widget ${chalk.gray(`(id: ${widgetId})`)}`);

    return { data: { id: widgetId, deleted: true }, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete board widget" });
    process.exit(1);
  }
};

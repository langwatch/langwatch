import chalk from "chalk";

import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import {
  type DefinitionFlags,
  resolveDefinitionInput,
  resolveSources,
  WidgetInputError,
} from "./definitionInput";

/** The flags `widget add` and `update` share beyond the definition. */
type WidgetFlags = DefinitionFlags & { name?: string; description?: string; sources?: string };

/** Ends the command on input refused before any request. */
const refusedLocally = <T>(resolve: () => T): T => {
  try {
    return resolve();
  } catch (error) {
    if (error instanceof WidgetInputError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }
};

/** The definition flags, resolved, with `--sources` set on every query when given. */
const definitionOf = (flags: WidgetFlags) => {
  const definition = refusedLocally(() => resolveDefinitionInput(flags));
  const sources = refusedLocally(() => resolveSources(flags.sources));
  if (!definition || !sources) return definition;
  return { ...definition, queries: definition.queries.map((query) => ({ ...query, sources })) };
};

/** `langwatch dashboard widget list <dashboardId>`: the widgets on one dashboard. */
export const listWidgetsOnDashboardCommand = async (
  dashboardId: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Fetching widgets on dashboard "${dashboardId}"...`).start();

  try {
    const result = await new DashboardsApiService().listWidgets(dashboardId);
    const widgets = result.data;
    spinner.succeed(`Found ${widgets.length} widget${widgets.length === 1 ? "" : "s"}`);

    return {
      data: result,
      table: () => {
        console.log();
        if (widgets.length === 0) {
          console.log(chalk.gray("No widgets on this dashboard."));
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
    failSpinner({ spinner, error, action: "fetch dashboard widgets" });
    process.exit(1);
  }
};

export const getWidgetOnDashboardCommand = async (
  dashboardId: string,
  widgetId: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Fetching widget "${widgetId}"...`).start();

  try {
    const widget = await new DashboardsApiService().getWidget({ dashboardId, widgetId });
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
    failSpinner({ spinner, error, action: "fetch dashboard widget" });
    process.exit(1);
  }
};

export const addWidgetToDashboardCommand = async (
  dashboardId: string,
  options: WidgetFlags,
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
    const widget = await new DashboardsApiService().createWidget({
      dashboardId,
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
    failSpinner({ spinner, error, action: "create dashboard widget" });
    process.exit(1);
  }
};

export const updateWidgetOnDashboardCommand = async (
  dashboardId: string,
  widgetId: string,
  options: WidgetFlags,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const definition = definitionOf(options);
  const sources = definition ? undefined : refusedLocally(() => resolveSources(options.sources));
  const named = options.name !== undefined || options.description !== undefined;
  if (!named && !definition && !sources) {
    console.error(
      chalk.red(
        "Error: nothing to update — pass --name, --description, --sources, or --code / --code-file with --queries-file",
      ),
    );
    process.exit(1);
  }
  const spinner = createSpinner(`Updating widget "${widgetId}"...`).start();

  try {
    const service = new DashboardsApiService();
    // --sources alone: every stored query, sent back with the new list.
    const resourced = sources && {
      queries: (await service.getWidget({ dashboardId, widgetId })).definition.queries.map(
        (query) => ({ ...query, sources }),
      ),
    };
    const widget = await service.updateWidget({
      dashboardId,
      widgetId,
      changes: {
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.description === undefined ? {} : { description: options.description }),
        ...definition,
        ...resourced,
      },
    });
    spinner.succeed(`Updated widget "${chalk.cyan(sanitizeTerminalText(widget.name))}"`);

    return { data: widget, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "update dashboard widget" });
    process.exit(1);
  }
};

export const deleteWidgetOnDashboardCommand = async (
  dashboardId: string,
  widgetId: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const spinner = createSpinner(`Deleting widget "${widgetId}"...`).start();

  try {
    await new DashboardsApiService().deleteWidget({ dashboardId, widgetId });
    spinner.succeed(`Deleted widget ${chalk.gray(`(id: ${widgetId})`)}`);

    return { data: { id: widgetId, deleted: true }, table: () => undefined };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete dashboard widget" });
    process.exit(1);
  }
};

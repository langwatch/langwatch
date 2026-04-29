import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the updated graph rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 */
export const updateGraphCommand = async (
  id: string,
  options: {
    name?: string;
    graph?: string;
    filters?: string;
  }
): Promise<CommandResult | void> => {
  checkApiKey();

  if (!options.name && !options.graph && !options.filters) {
    reportCommandError({
      error: commandValidationError(
        "At least one of --name, --graph, or --filters is required",
      ),
    });
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating graph "${id}"...`).start();

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.graph) {
      body.graph = JSON.parse(options.graph) as Record<string, unknown>;
    }
    if (options.filters) {
      body.filters = JSON.parse(options.filters) as Record<string, unknown>;
    }

    const graph = (await apiRequest({
      method: "PATCH",
      path: `/api/graphs/${id}`,
      apiKey,
      endpoint,
      body,
    })) as {
      id: string;
      name: string;
    };
    spinner.succeed(`Graph "${graph.name}" updated`);

    return {
      data: graph,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(graph.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(graph.name)}`);
        console.log();
      },
    };
  } catch (error) {
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there).
    failSpinner({
      spinner,
      error:
        error instanceof SyntaxError
          ? commandValidationError("--graph and --filters must be valid JSON")
          : error,
      action: "update graph",
    });
    process.exit(1);
  }
};

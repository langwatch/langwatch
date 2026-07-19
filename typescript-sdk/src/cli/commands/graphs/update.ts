import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const updateGraphCommand = async (
  id: string,
  options: {
    name?: string;
    graph?: string;
    filters?: string;
    format?: string;
  }
): Promise<void> => {
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

    const response = await fetch(`${endpoint}/api/graphs/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "update graph" });
      process.exit(1);
    }

    const graph = (await response.json()) as {
      id: string;
      name: string;
    };
    spinner.succeed(`Graph "${graph.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(graph, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}   ${chalk.green(graph.id)}`);
    console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(graph.name)}`);
    console.log();
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

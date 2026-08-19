import chalk from "chalk";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError } from "../../utils/errorOutput";
import { formatFetchError } from "../../utils/formatFetchError";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
/**
 * Returns the created graph rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 */
export const createGraphCommand = async (
  name: string,
  options: {
    dashboardId?: string;
    graph?: string;
    filters?: string;
    colSpan?: string;
    rowSpan?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Creating graph "${name}"...`).start();

  try {
    let graphDef: Record<string, unknown> = {};
    if (options.graph) {
      graphDef = JSON.parse(options.graph) as Record<string, unknown>;
    }

    const response = await fetch(`${endpoint}/api/graphs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        name,
        graph: graphDef,
        dashboardId: options.dashboardId,
        ...(options.filters && { filters: JSON.parse(options.filters) }),
        ...(options.colSpan && { colSpan: parseInt(options.colSpan, 10) }),
        ...(options.rowSpan && { rowSpan: parseInt(options.rowSpan, 10) }),
      }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({
        spinner,
        error: new Error(message),
        action: "create graph",
      });
      process.exit(1);
    }

    const graph = (await response.json()) as {
      id: string;
      name: string;
      dashboardId: string | null;
    };
    spinner.succeed(`Graph "${graph.name}" created (${graph.id})`);

    return {
      data: graph,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}        ${chalk.green(graph.id)}`);
        console.log(
          `  ${chalk.gray("Dashboard:")} ${graph.dashboardId ?? chalk.gray("—")}`,
        );
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
      action: "create graph",
    });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the graph rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getGraphCommand = async (
  id: string
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Fetching graph "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/graphs/${id}`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch graph" });
      process.exit(1);
    }

    const graph = (await response.json()) as {
      id: string;
      name: string;
      dashboardId: string | null;
      graph: Record<string, unknown>;
      filters: Record<string, unknown> | null;
      gridColumn: number;
      gridRow: number;
      colSpan: number;
      rowSpan: number;
      createdAt: string;
      updatedAt: string;
    };

    spinner.succeed(`Graph "${graph.name}"`);

    return {
      data: graph,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}        ${chalk.green(graph.id)}`);
        console.log(`  ${chalk.gray("Name:")}      ${chalk.cyan(graph.name)}`);
        console.log(
          `  ${chalk.gray("Dashboard:")} ${graph.dashboardId ?? chalk.gray("—")}`
        );
        console.log(
          `  ${chalk.gray("Position:")}  (${graph.gridColumn}, ${graph.gridRow})`
        );
        console.log(`  ${chalk.gray("Size:")}      ${graph.colSpan}x${graph.rowSpan}`);
        if (graph.graph) {
          const graphType = typeof graph.graph.type === "string" ? graph.graph.type : "custom";
          console.log(`  ${chalk.gray("Type:")}      ${graphType}`);
        }
        console.log(
          `  ${chalk.gray("Created:")}   ${new Date(graph.createdAt).toLocaleString()}`
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch graph" });
    process.exit(1);
  }
};

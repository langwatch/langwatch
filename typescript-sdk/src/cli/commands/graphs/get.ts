import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";

export const getGraphCommand = async (
  id: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Fetching graph "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/graphs/${id}`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch graph: ${message}`);
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

    if (options?.format === "json") {
      console.log(JSON.stringify(graph, null, 2));
      return;
    }

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
  } catch (error) {
    spinner.fail();
    console.error(
      chalk.red(
        `Error: ${formatApiErrorMessage({ error })}`
      )
    );
    process.exit(1);
  }
};

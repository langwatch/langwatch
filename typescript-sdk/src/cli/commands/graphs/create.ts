import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";

export const createGraphCommand = async (
  name: string,
  options: {
    dashboardId?: string;
    graph?: string;
    filters?: string;
    colSpan?: string;
    rowSpan?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Creating graph "${name}"...`).start();

  try {
    let graphDef: Record<string, unknown> = {};
    if (options.graph) {
      graphDef = JSON.parse(options.graph) as Record<string, unknown>;
    }

    const response = await fetch(`${endpoint}/api/graphs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
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
      const errorBody = await response.text();
      spinner.fail(`Failed to create graph (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
      process.exit(1);
    }

    const graph = await response.json() as { id: string; name: string; dashboardId: string | null };
    spinner.succeed(`Graph "${graph.name}" created (${graph.id})`);

    if (options.format === "json") {
      console.log(JSON.stringify(graph, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}        ${chalk.green(graph.id)}`);
    console.log(`  ${chalk.gray("Dashboard:")} ${graph.dashboardId ?? chalk.gray("—")}`);
    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof SyntaxError) {
      console.error(chalk.red("Error: --graph must be valid JSON"));
    } else {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
    }
    process.exit(1);
  }
};

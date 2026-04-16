import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";

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
    console.error(
      chalk.red(
        "Error: At least one of --name, --graph, or --filters is required"
      )
    );
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Updating graph "${id}"...`).start();

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
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to update graph: ${message}`);
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
    spinner.fail();
    if (error instanceof SyntaxError) {
      console.error(
        chalk.red("Error: --graph and --filters must be valid JSON")
      );
    } else {
      console.error(
        chalk.red(
          `Error: ${formatApiErrorMessage({ error })}`
        )
      );
    }
    process.exit(1);
  }
};

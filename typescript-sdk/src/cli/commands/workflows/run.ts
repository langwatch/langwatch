import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";

export const runWorkflowCommand = async (
  id: string,
  options: { input?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const spinner = ora(`Running workflow "${id}"...`).start();

  try {
    let input: Record<string, unknown> = {};
    if (options.input) {
      input = JSON.parse(options.input) as Record<string, unknown>;
    }

    // Workflow run API is on the pages API, not the Hono app API
    const apiKey = process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

    const response = await fetch(`${endpoint}/api/workflows/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Workflow execution failed: ${message}`);
      process.exit(1);
    }

    const result = await response.json() as Record<string, unknown>;

    spinner.succeed(`Workflow "${id}" executed successfully`);

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log();
      if (result.output !== undefined) {
        console.log(chalk.bold("  Output:"));
        const output = typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output, null, 2);
        console.log(`    ${output.split("\n").join("\n    ")}`);
      } else {
        console.log(chalk.bold("  Result:"));
        console.log(`    ${JSON.stringify(result, null, 2).split("\n").join("\n    ")}`);
      }
      console.log();
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof SyntaxError) {
      console.error(chalk.red("Error: --input must be valid JSON"));
    } else {
      console.error(
        chalk.red(
          `Error running workflow: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};

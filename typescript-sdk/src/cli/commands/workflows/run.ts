import chalk from "chalk";
import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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

    let result: Record<string, unknown>;
    try {
      result = (await apiRequest({
        method: "POST",
        path: `/api/workflows/${encodeURIComponent(id)}/run`,
        apiKey,
        endpoint,
        body: input,
      })) as Record<string, unknown>;
    } catch (httpError) {
      const message = httpError instanceof Error ? httpError.message : String(httpError);
      spinner.fail(`Workflow execution failed: ${message}`);
      process.exit(1);
    }

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
    if (error instanceof SyntaxError) {
      spinner.fail(chalk.red("--input must be valid JSON"));
    } else {
      failSpinner({ spinner, error, action: "run workflow" });
    }
    process.exit(1);
  }
};

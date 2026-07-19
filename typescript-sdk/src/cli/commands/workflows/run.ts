import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const runWorkflowCommand = async (
  id: string,
  options: { input?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const spinner = createSpinner(`Running workflow "${id}"...`).start();

  try {
    let input: Record<string, unknown> = {};
    if (options.input) {
      input = JSON.parse(options.input) as Record<string, unknown>;
    }

    // Workflow run API is on the pages API, not the Hono app API
    const apiKey = process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = resolveControlPlaneUrl();

    const response = await fetch(`${endpoint}/api/workflows/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "run workflow" });
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
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there).
    failSpinner({
      spinner,
      error:
        error instanceof SyntaxError
          ? commandValidationError("--input must be valid JSON")
          : error,
      action: "run workflow",
    });
    process.exit(1);
  }
};

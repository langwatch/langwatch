import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const runWorkflowCommand = async (
  id: string,
  options: { input?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  // Parsed before the request, and outside its try: `await response.json()`
  // throws SyntaxError too, so sharing one catch reported a malformed SERVER
  // body as `--input must be valid JSON` — an input error the caller never made.
  let input: Record<string, unknown> = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input) as Record<string, unknown>;
    } catch {
      reportCommandError({
        error: commandValidationError("--input must be valid JSON"),
      });
      process.exit(1);
    }
  }

  const spinner = createSpinner(`Running workflow "${id}"...`).start();

  try {
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

    return {
      data: result,
      table: () => {
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
      },
    };
  } catch (error) {
    // failSpinner, not spinner.fail(): a direct spinner.fail() prints nothing
    // in --json/--jq/agent mode (spinners are silent there).
    failSpinner({ spinner, error, action: "run workflow" });
    process.exit(1);
  }
};

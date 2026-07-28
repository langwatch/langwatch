import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the updated monitor rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const updateMonitorCommand = async (
  id: string,
  options: {
    name?: string;
    enabled?: string;
    executionMode?: string;
    sample?: string;
    parameters?: string;
  }
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating monitor "${id}"...`).start();

  let monitor: {
    id: string;
    name: string;
    enabled: boolean;
  };
  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.enabled !== undefined)
      body.enabled = options.enabled === "true";
    if (options.executionMode) body.executionMode = options.executionMode;
    if (options.sample) body.sample = parseFloat(options.sample);
    if (options.parameters) {
      body.parameters = JSON.parse(options.parameters) as Record<
        string,
        unknown
      >;
    }

    const response = await fetch(`${endpoint}/api/monitors/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "update monitor" });
      process.exit(1);
    }

    monitor = (await response.json()) as {
      id: string;
      name: string;
      enabled: boolean;
    };

    spinner.succeed(`Monitor "${monitor.name}" updated`);
  } catch (error) {
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there),
    // so an invalid --parameters would exit 1 with no machine-readable error.
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({
      spinner,
      error:
        error instanceof SyntaxError
          ? commandValidationError("--parameters must be valid JSON")
          : error,
      action: "update monitor",
    });
    process.exit(1);
  }

  return {
    data: monitor,
    table: () => {
      console.log();
      console.log(`  ${chalk.gray("ID:")}      ${chalk.green(monitor.id)}`);
      console.log(`  ${chalk.gray("Name:")}    ${chalk.cyan(monitor.name)}`);
      console.log(
        `  ${chalk.gray("Enabled:")} ${monitor.enabled ? chalk.green("yes") : chalk.gray("no")}`
      );
      console.log();
    },
  };
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { printResult, type RawOutputFlags } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const createMonitorCommand = async (
  name: string,
  options: {
    checkType: string;
    executionMode?: string;
    sample?: string;
    evaluatorId?: string;
    level?: string;
    parameters?: string;
  } & RawOutputFlags
): Promise<void> => {
  checkApiKey();

  const validModes = ["ON_MESSAGE", "AS_GUARDRAIL", "MANUALLY"];
  if (options.executionMode && !validModes.includes(options.executionMode)) {
    console.error(
      chalk.red(`Error: --execution-mode must be one of: ${validModes.join(", ")}`)
    );
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Creating monitor "${name}"...`).start();

  try {
    let parameters: Record<string, unknown> = {};
    if (options.parameters) {
      parameters = JSON.parse(options.parameters) as Record<string, unknown>;
    }

    const response = await fetch(`${endpoint}/api/monitors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        name,
        checkType: options.checkType,
        executionMode: options.executionMode ?? "ON_MESSAGE",
        sample: options.sample ? parseFloat(options.sample) : 1.0,
        evaluatorId: options.evaluatorId,
        level: options.level ?? "trace",
        parameters,
        preconditions: [],
      }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to create monitor: ${message}`);
      process.exit(1);
    }

    const monitor = (await response.json()) as {
      id: string;
      name: string;
      checkType: string;
      executionMode: string;
      platformUrl?: string;
    };

    spinner.succeed(`Monitor "${monitor.name}" created (${monitor.id})`);

    await printResult(monitor, {
      ...options,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(monitor.id)}`);
        console.log(`  ${chalk.gray("Type:")} ${monitor.checkType}`);
        console.log(`  ${chalk.gray("Mode:")} ${monitor.executionMode}`);
        if (monitor.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(monitor.platformUrl)}`);
        }
        console.log();
      },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      spinner.fail(chalk.red("--parameters must be valid JSON"));
    } else {
      // No explicit `format`: see traces/search.ts — the preAction hook covers
      // every spelling; the `-f` commander default must not override it.
      failSpinner({ spinner, error, action: "create monitor" });
    }
    process.exit(1);
  }
};

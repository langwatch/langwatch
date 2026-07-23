import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the monitor rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getMonitorCommand = async (
  id: string
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Fetching monitor "${id}"...`).start();

  let monitor: {
    id: string;
    name: string;
    slug: string;
    checkType: string;
    enabled: boolean;
    executionMode: string;
    sample: number;
    level: string;
    evaluatorId: string | null;
    preconditions: unknown;
    createdAt: string;
    platformUrl?: string;
  };
  try {
    const response = await fetch(`${endpoint}/api/monitors/${id}`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch monitor" });
      process.exit(1);
    }

    monitor = (await response.json()) as {
      id: string;
      name: string;
      slug: string;
      checkType: string;
      enabled: boolean;
      executionMode: string;
      sample: number;
      level: string;
      evaluatorId: string | null;
      preconditions: unknown;
      createdAt: string;
      platformUrl?: string;
    };

    spinner.succeed(`Monitor "${monitor.name}"`);
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "fetch monitor" });
    process.exit(1);
  }

  return {
    data: monitor,
    table: () => {
      console.log();
      console.log(`  ${chalk.gray("ID:")}        ${chalk.green(monitor.id)}`);
      console.log(`  ${chalk.gray("Name:")}      ${chalk.cyan(monitor.name)}`);
      console.log(`  ${chalk.gray("Slug:")}      ${monitor.slug}`);
      console.log(`  ${chalk.gray("Type:")}      ${monitor.checkType}`);
      console.log(
        `  ${chalk.gray("Status:")}    ${monitor.enabled ? chalk.green("enabled") : chalk.gray("disabled")}`
      );
      console.log(`  ${chalk.gray("Mode:")}      ${monitor.executionMode}`);
      console.log(`  ${chalk.gray("Sample:")}    ${Math.round(monitor.sample * 100)}%`);
      console.log(`  ${chalk.gray("Level:")}     ${monitor.level}`);
      if (monitor.evaluatorId) {
        console.log(
          `  ${chalk.gray("Evaluator:")} ${monitor.evaluatorId}`
        );
      }
      console.log(
        `  ${chalk.gray("Created:")}   ${new Date(monitor.createdAt).toLocaleString()}`
      );
      if (monitor.platformUrl) {
        console.log(`  ${chalk.bold("View:")}     ${chalk.underline(monitor.platformUrl)}`);
      }
      console.log();
    },
  };
};

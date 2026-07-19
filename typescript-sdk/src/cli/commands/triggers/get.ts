import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the trigger rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). `data` is the raw
 * record, so a machine caller keeps `actionParams` and `updatedAt`, which the
 * human view omits.
 */
export const getTriggerCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Fetching trigger "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/triggers/${encodeURIComponent(id)}`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: `fetch trigger "${id}"` });
      process.exit(1);
    }

    const trigger = await response.json() as {
      id: string;
      name: string;
      action: string;
      actionParams: Record<string, unknown>;
      filters: Record<string, unknown>;
      active: boolean;
      message: string | null;
      alertType: string | null;
      createdAt: string;
      updatedAt: string;
      platformUrl?: string;
    };

    spinner.succeed(`Found trigger "${trigger.name}"`);

    return {
      data: trigger,
      table: () => {
        console.log();
        console.log(chalk.bold("  Trigger Details:"));
        console.log(`    ${chalk.gray("ID:")}      ${chalk.green(trigger.id)}`);
        console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(trigger.name)}`);
        console.log(`    ${chalk.gray("Action:")}  ${trigger.action}`);
        console.log(`    ${chalk.gray("Status:")}  ${trigger.active ? chalk.green("active") : chalk.gray("inactive")}`);
        console.log(`    ${chalk.gray("Alert:")}   ${trigger.alertType ?? chalk.gray("—")}`);
        console.log(`    ${chalk.gray("Message:")} ${trigger.message ?? chalk.gray("—")}`);
        console.log(`    ${chalk.gray("Created:")} ${new Date(trigger.createdAt).toLocaleString()}`);
        if (trigger.platformUrl) {
          console.log(`    ${chalk.bold("View:")}   ${chalk.underline(trigger.platformUrl)}`);
        }

        if (Object.keys(trigger.filters).length > 0) {
          console.log();
          console.log(chalk.bold("  Filters:"));
          console.log(`    ${JSON.stringify(trigger.filters, null, 2).split("\n").join("\n    ")}`);
        }

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch trigger" });
    process.exit(1);
  }
};

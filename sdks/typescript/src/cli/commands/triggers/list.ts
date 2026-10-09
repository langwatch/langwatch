import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinnerFromResponse } from "../../utils/failFromResponse";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { summariseRule, type TriggerRecord } from "./summary";
import { triggerRequest } from "./triggerRequest";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const listTriggersCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner("Fetching triggers...").start();

  try {
    const response = await triggerRequest({});

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: "fetch triggers" });
      process.exit(1);
    }

    const triggers: TriggerRecord[] = await response.json();

    spinner.succeed(`Found ${triggers.length} trigger${triggers.length !== 1 ? "s" : ""}`);

    return {
      // The API redacts delivery credentials before it answers, so machine
      // output is the listing exactly as it arrived.
      data: triggers,
      table: () => {
        if (triggers.length === 0) {
          console.log();
          console.log(chalk.gray("No triggers found."));
          console.log(chalk.gray("Create one with:"));
          console.log(chalk.cyan('  langwatch trigger create "My Alert" --action SEND_EMAIL'));
          return;
        }

        console.log();

        const tableData = triggers.map((t) => ({
          Name: t.name,
          ID: t.id,
          Kind: t.kind ?? "-",
          Action: t.action,
          Status: t.active ? chalk.green("active") : chalk.gray("inactive"),
          Alert: t.alertType ?? chalk.gray("—"),
          Rule: summariseRule(t),
          Query: t.filterQuery ?? "-",
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Kind", "Action", "Status", "Alert", "Rule", "Query"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch triggers" });
    process.exit(1);
  }
};

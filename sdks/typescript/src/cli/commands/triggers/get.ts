import chalk from "chalk";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import {
  summariseGraphAlert,
  summariseReport,
  summariseSlackConnection,
  type TriggerRecord,
} from "./summary.ts";
import { triggerRequest } from "./triggerRequest.ts";

function printTrigger({ trigger }: { trigger: TriggerRecord }): void {
  console.log();
  console.log(chalk.bold("  Trigger Details:"));
  console.log(`    ${chalk.gray("ID:")}      ${chalk.green(trigger.id)}`);
  console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(trigger.name)}`);
  console.log(`    ${chalk.gray("Action:")}  ${trigger.action}`);
  if (trigger.kind) console.log(`    ${chalk.gray("Kind:")}    ${trigger.kind}`);
  const slack = summariseSlackConnection({ actionParams: trigger.actionParams });
  if (slack) console.log(`    ${chalk.gray("Slack:")}   ${slack}`);
  console.log(
    `    ${chalk.gray("Status:")}  ${trigger.active ? chalk.green("active") : chalk.gray("inactive")}`,
  );
  console.log(`    ${chalk.gray("Alert:")}   ${trigger.alertType ?? chalk.gray("—")}`);
  console.log(`    ${chalk.gray("Message:")} ${trigger.message ?? chalk.gray("—")}`);
  console.log(`    ${chalk.gray("Created:")} ${new Date(trigger.createdAt).toLocaleString()}`);
  if (trigger.platformUrl) {
    console.log(`    ${chalk.bold("View:")}   ${chalk.underline(trigger.platformUrl)}`);
  }
  const alert = summariseGraphAlert({
    graphAlert: trigger.graphAlert,
    customGraphId: trigger.customGraphId,
  });
  if (alert) console.log(`    ${chalk.gray("Fires when:")} ${alert}`);
  const report = summariseReport({ report: trigger.report });
  if (report) console.log(`    ${chalk.gray("Report:")}  ${report}`);
  if (trigger.filterQuery) {
    console.log(`    ${chalk.gray("Query:")}   ${trigger.filterQuery}`);
  }

  if (Object.keys(trigger.filters).length > 0) {
    console.log();
    console.log(chalk.bold("  Filters:"));
    console.log(`    ${JSON.stringify(trigger.filters, null, 2).split("\n").join("\n    ")}`);
  }

  console.log();
}

/**
 * Returns the trigger rather than printing it: the output port renders it in the caller's format
 * (utils/output.ts). `data` is the raw record, so a machine caller keeps `actionParams` and
 * `updatedAt`, which the human view omits.
 */
export const getTriggerCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(`Fetching trigger "${id}"...`).start();

  try {
    const response = await triggerRequest({ path: `/${encodeURIComponent(id)}` });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: `fetch trigger "${id}"` });
      process.exit(1);
    }

    const trigger: TriggerRecord = await response.json();

    spinner.succeed(`Found trigger "${trigger.name}"`);

    return {
      // `actionParams` arrives with its delivery credentials already redacted,
      // so machine output is the response exactly as the API answered it.
      data: trigger,
      table: () => printTrigger({ trigger }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch trigger" });
    process.exit(1);
  }
};

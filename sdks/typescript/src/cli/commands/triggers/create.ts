import chalk from "chalk";
import { createSpinner } from "../../utils/spinner.ts";
import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput.ts";
import type { CommandResult } from "../../utils/output.ts";
import { parseJsonFlags } from "./parseJsonObject.ts";
import { slackShorthands } from "./slackShorthands.ts";
import { summariseSlackConnection, type TriggerRecord } from "./summary.ts";
import { triggerRequest } from "./triggerRequest.ts";

/**
 * Returns the created trigger rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const createTriggerCommand = async (
  name: string,
  options: {
    action: string;
    filters?: string;
    filterQuery?: string;
    message?: string;
    alertType?: string;
    slackWebhook?: string;
    slackConnection?: string;
    slackChannel?: string;
    actionParams?: string;
    customGraphId?: string;
    graphAlert?: string;
    report?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const validActions = ["SEND_EMAIL", "ADD_TO_DATASET", "ADD_TO_ANNOTATION_QUEUE", "SEND_SLACK_MESSAGE", "SEND_WEBHOOK"];
  if (!validActions.includes(options.action)) {
    reportCommandError({
      error: commandValidationError(
        `--action must be one of: ${validActions.join(", ")}`,
      ),
    });
    process.exit(1);
  }

  const spinner = createSpinner(`Creating trigger "${name}"...`).start();
  const flags = parseJsonFlags({ options, spinner, action: "create trigger" });
  // `--slack-webhook` is legacy: the server stores the URL as a connection.
  const actionParams = { ...flags.actionParams, ...slackShorthands(options) };

  try {
    const response = await triggerRequest({
      method: "POST",
      body: {
        name,
        action: options.action,
        filters: flags.filters,
        filterQuery: options.filterQuery,
        actionParams,
        message: options.message,
        alertType: options.alertType,
        customGraphId: options.customGraphId,
        graphAlert: flags.graphAlert,
        report: flags.report,
      },
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: "create trigger" });
      process.exit(1);
    }

    const trigger: TriggerRecord = await response.json();
    spinner.succeed(`Trigger "${trigger.name}" created (${trigger.id})`);

    return {
      // The API redacts delivery credentials before it answers, so machine
      // output is the response exactly as it arrived.
      data: trigger,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}     ${chalk.green(trigger.id)}`);
        console.log(`  ${chalk.gray("Action:")} ${trigger.action}`);
        if (trigger.kind) console.log(`  ${chalk.gray("Kind:")}   ${trigger.kind}`);
        const slack = summariseSlackConnection({ actionParams: trigger.actionParams });
        if (slack) console.log(`  ${chalk.gray("Slack:")}  ${slack}`);
        if (trigger.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(trigger.platformUrl)}`);
        }
        console.log();
      },
    };
  } catch (error) {
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there).
    failSpinner({
      spinner,
      error,
      action: "create trigger",
    });
    process.exit(1);
  }
};

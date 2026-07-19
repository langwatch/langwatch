import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const createTriggerCommand = async (
  name: string,
  options: {
    action: string;
    filters?: string;
    message?: string;
    alertType?: string;
    slackWebhook?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  const validActions = ["SEND_EMAIL", "ADD_TO_DATASET", "ADD_TO_ANNOTATION_QUEUE", "SEND_SLACK_MESSAGE"];
  if (!validActions.includes(options.action)) {
    reportCommandError({
      error: commandValidationError(
        `--action must be one of: ${validActions.join(", ")}`,
      ),
    });
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Creating trigger "${name}"...`).start();

  try {
    let filters: Record<string, unknown> = {};
    if (options.filters) {
      filters = JSON.parse(options.filters) as Record<string, unknown>;
    }

    const actionParams: Record<string, unknown> = {};
    if (options.slackWebhook) actionParams.slackWebhook = options.slackWebhook;

    const response = await fetch(`${endpoint}/api/triggers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        name,
        action: options.action,
        filters,
        actionParams,
        message: options.message,
        alertType: options.alertType,
      }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "create trigger" });
      process.exit(1);
    }

    const trigger = await response.json() as { id: string; name: string; action: string; platformUrl?: string };
    spinner.succeed(`Trigger "${trigger.name}" created (${trigger.id})`);

    if (options.format === "json") {
      console.log(JSON.stringify(trigger, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}     ${chalk.green(trigger.id)}`);
    console.log(`  ${chalk.gray("Action:")} ${trigger.action}`);
    if (trigger.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(trigger.platformUrl)}`);
    }
    console.log();
  } catch (error) {
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there).
    failSpinner({
      spinner,
      error:
        error instanceof SyntaxError
          ? commandValidationError("--filters must be valid JSON")
          : error,
      action: "create trigger",
    });
    process.exit(1);
  }
};

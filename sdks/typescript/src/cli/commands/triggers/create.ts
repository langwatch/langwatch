import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";
import { TRIGGER_REQUEST_TIMEOUT_MS } from "./requestTimeout";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

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
    actionParams?: string;
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

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Creating trigger "${name}"...`).start();

  // Parsed BEFORE the request, in their own narrow guard — the outer catch
  // must not misread a non-JSON API response as a flag the user never passed.
  let filters: Record<string, unknown> | undefined;
  let actionParams: Record<string, unknown> = {};
  try {
    if (options.filters) {
      filters = JSON.parse(options.filters) as Record<string, unknown>;
    }
    if (options.actionParams) {
      actionParams = JSON.parse(options.actionParams) as Record<string, unknown>;
    }
  } catch {
    failSpinner({
      spinner,
      error: commandValidationError("--filters and --action-params must be valid JSON"),
      action: "create trigger",
    });
    process.exit(1);
  }
  // The delivery configuration the chosen channel reads. `--slack-webhook`
  // is the shorthand for the one field a Slack automation most often needs;
  // everything else is stated with `--action-params`.
  if (options.slackWebhook) actionParams.slackWebhook = options.slackWebhook;

  try {

    const response = await fetch(`${endpoint}/api/triggers`, {
      signal: AbortSignal.timeout(TRIGGER_REQUEST_TIMEOUT_MS),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        name,
        action: options.action,
        filters,
        filterQuery: options.filterQuery,
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

    return {
      // The API redacts delivery credentials before it answers, so machine
      // output is the response exactly as it arrived.
      data: trigger,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}     ${chalk.green(trigger.id)}`);
        console.log(`  ${chalk.gray("Action:")} ${trigger.action}`);
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

import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinnerFromResponse } from "../../utils/failFromResponse";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { parseJsonFlags } from "./parseJsonObject";
import { slackShorthands } from "./slackShorthands";
import type { TriggerRecord } from "./summary";
import { triggerRequest } from "./triggerRequest";

/**
 * Returns the updated trigger rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const updateTriggerCommand = async (
  id: string,
  options: {
    name?: string;
    active?: string;
    message?: string;
    alertType?: string;
    filters?: string;
    filterQuery?: string;
    actionParams?: string;
    slackConnection?: string;
    slackChannel?: string;
    graphAlert?: string;
    report?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(`Updating trigger "${id}"...`).start();
  const flags = parseJsonFlags({ options, spinner, action: "update trigger" });

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.active !== undefined) body.active = options.active === "true";
    if (options.message !== undefined) body.message = options.message || null;
    if (options.alertType) body.alertType = options.alertType;
    if (flags.filters) body.filters = flags.filters;
    if (options.filterQuery !== undefined) {
      body.filterQuery = options.filterQuery || null;
    }
    // The delivery configuration this automation should have from now on: it
    // replaces the stored one rather than merging into it. A credential the
    // read hid comes back as `[redacted]`; send that to keep the stored value.
    const slack = slackShorthands(options);
    if (flags.actionParams || Object.keys(slack).length > 0) {
      body.actionParams = { ...flags.actionParams, ...slack };
    }
    if (flags.graphAlert) body.graphAlert = flags.graphAlert;
    if (flags.report) body.report = flags.report;

    if (Object.keys(body).length === 0) {
      failSpinner({
        spinner,
        error: commandValidationError(
          "No fields to update. Use --name, --active, --message, --alert-type, --filters, --filter-query, --action-params, --slack-connection, --slack-channel, --graph-alert or --report.",
        ),
        action: "update trigger",
      });
      process.exit(1);
    }

    const response = await triggerRequest({
      path: `/${encodeURIComponent(id)}`,
      method: "PATCH",
      body,
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: "update trigger" });
      process.exit(1);
    }

    const trigger: TriggerRecord = await response.json();
    spinner.succeed(`Trigger "${trigger.name}" updated`);

    return {
      data: trigger,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({
      spinner,
      error,
      action: "update trigger",
    });
    process.exit(1);
  }
};

import { createSpinner } from "../../utils/spinner";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

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
  },
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating trigger "${id}"...`).start();

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.active !== undefined) body.active = options.active === "true";
    if (options.message !== undefined) body.message = options.message || null;
    if (options.alertType) body.alertType = options.alertType;

    if (Object.keys(body).length === 0) {
      failSpinner({
        spinner,
        error: commandValidationError(
          "No fields to update. Use --name, --active, --message, or --alert-type.",
        ),
        action: "update trigger",
      });
      process.exit(1);
    }

    const trigger = (await apiRequest({
      method: "PATCH",
      path: `/api/triggers/${encodeURIComponent(id)}`,
      apiKey,
      endpoint,
      body,
    })) as { id: string; name: string; active: boolean };
    spinner.succeed(`Trigger "${trigger.name}" updated`);

    return {
      data: trigger,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update trigger" });
    process.exit(1);
  }
};

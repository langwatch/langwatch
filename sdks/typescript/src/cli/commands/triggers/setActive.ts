import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import type { TriggerRecord } from "./summary.ts";
import { triggerRequest } from "./triggerRequest.ts";

/**
 * Resume or pause an automation. A report's schedule follows: pausing retires
 * its calendar entry so it stops claiming its slot, and resuming puts it back.
 */
export const setTriggerActiveCommand = async ({
  id,
  active,
}: {
  id: string;
  active: boolean;
}): Promise<CommandResult | void> => {
  await resolveCredentials();
  const verb = active ? "enable" : "disable";

  const spinner = createSpinner(
    `${active ? "Resuming" : "Pausing"} trigger "${id}"...`,
  ).start();

  try {
    const response = await triggerRequest({
      path: `/${encodeURIComponent(id)}/${verb}`,
      method: "POST",
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: `${verb} trigger` });
      process.exit(1);
    }

    const trigger: Pick<TriggerRecord, "id" | "name" | "active"> =
      await response.json();
    spinner.succeed(
      `Trigger "${trigger.name}" is now ${trigger.active ? "running" : "paused"}`,
    );

    return {
      // The state answer carries only id, name and active, so machine output
      // is the response exactly as it arrived.
      data: trigger,
      table: () => {
        // The spinner line above is the whole human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: `${verb} trigger` });
    process.exit(1);
  }
};

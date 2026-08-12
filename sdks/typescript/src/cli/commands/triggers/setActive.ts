import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Resume or pause an automation. A report's schedule follows: pausing retires
 * its calendar entry so it stops claiming its slot, and resuming puts it back.
 */
export const setTriggerActiveCommand = async (
  id: string,
  { active }: { active: boolean },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();
  const verb = active ? "enable" : "disable";

  const spinner = createSpinner(
    `${active ? "Resuming" : "Pausing"} trigger "${id}"...`,
  ).start();

  try {
    const response = await fetch(
      `${endpoint}/api/triggers/${encodeURIComponent(id)}/${verb}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey }),
        },
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({
        spinner,
        error: new Error(message),
        action: `${verb} trigger`,
      });
      process.exit(1);
    }

    const trigger = (await response.json()) as {
      id: string;
      name: string;
      active: boolean;
    };
    spinner.succeed(
      `Trigger "${trigger.name}" is now ${trigger.active ? "running" : "paused"}`,
    );

    return {
      // The API redacts delivery credentials before it answers, so machine
      // output is the response exactly as it arrived.
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

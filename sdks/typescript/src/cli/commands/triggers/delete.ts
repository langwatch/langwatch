import { scopedApiKey } from "@/internal/credentialContext";
import { createSpinner } from "../../utils/spinner.ts";
import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output.ts";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

/**
 * Returns the deletion result rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteTriggerCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Deleting trigger "${id}"...`).start();

  try {
    const response = await langwatchFetch(`${endpoint}/api/v1/triggers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      await failSpinnerFromResponse({
        spinner,
        response,
        action: `delete trigger "${id}"`,
      });
      process.exit(1);
    }

    const result = (await response.json()) as { id: string; deleted: boolean };
    spinner.succeed(`Trigger "${id}" deleted`);

    return {
      data: result,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete trigger" });
    process.exit(1);
  }
};

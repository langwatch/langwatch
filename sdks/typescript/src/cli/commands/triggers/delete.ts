import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the deletion result rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteTriggerCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Deleting trigger "${id}"...`).start();

  try {
    const response = await fetch(
      `${endpoint}/api/triggers/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: buildAuthHeaders({ apiKey }),
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({
        spinner,
        error: new Error(message),
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

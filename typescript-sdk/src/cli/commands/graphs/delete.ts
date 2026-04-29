import { createSpinner } from "../../utils/spinner";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the deletion outcome rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteGraphCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Deleting graph "${id}"...`).start();

  try {
    const result = (await apiRequest({
      method: "DELETE",
      path: `/api/graphs/${encodeURIComponent(id)}`,
      apiKey,
      endpoint,
    })) as { id: string; deleted: boolean };
    spinner.succeed(`Graph "${id}" deleted`);

    return {
      data: result,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: `delete graph "${id}"` });
    process.exit(1);
  }
};

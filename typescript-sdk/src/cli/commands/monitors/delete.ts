import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
/**
 * Returns the deletion outcome rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteMonitorCommand = async (
  id: string
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Deleting monitor "${id}"...`).start();

  let result: {
    id: string;
    deleted: boolean;
  };
  try {
    const response = await fetch(`${endpoint}/api/monitors/${id}`, {
      method: "DELETE",
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "delete monitor" });
      process.exit(1);
    }

    result = (await response.json()) as {
      id: string;
      deleted: boolean;
    };

    spinner.succeed(`Monitor deleted (${result.id})`);
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "delete monitor" });
    process.exit(1);
  }

  return {
    data: result,
    table: () => {
      // The spinner's success line is the human output.
    },
  };
};

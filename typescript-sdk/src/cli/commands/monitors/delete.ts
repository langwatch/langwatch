import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { printResult, type RawOutputFlags } from "../../utils/output";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
export const deleteMonitorCommand = async (
  id: string,
  options?: RawOutputFlags
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Deleting monitor "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/monitors/${id}`, {
      method: "DELETE",
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to delete monitor: ${message}`);
      process.exit(1);
    }

    const result = (await response.json()) as {
      id: string;
      deleted: boolean;
    };

    spinner.succeed(`Monitor deleted (${result.id})`);

    await printResult(result, {
      ...options,
      table: () => {
        // The spinner's success line is the human output.
      },
    });
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "delete monitor" });
    process.exit(1);
  }
};

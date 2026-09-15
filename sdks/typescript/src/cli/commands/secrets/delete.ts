import { scopedApiKey } from "@/internal/credentialContext";
import { createSpinner } from "../../utils/spinner.ts";
import { resolveCredentials } from "../../utils/apiKey.ts";
import { formatFetchError } from "../../utils/formatFetchError.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output.ts";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

/**
 * Returns the deletion result rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteSecretCommand = async (id: string): Promise<CommandResult | void> => {
  const credentials = await resolveCredentials();
  if (!credentials.projectId) {
    throw new Error("A project must be selected for secret operations");
  }

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Deleting secret "${id}"...`).start();

  try {
    const response = await langwatchFetch(`${endpoint}/api/v1/secret/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({ projectId: credentials.projectId }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "delete secret" });
      process.exit(1);
    }

    const result = (await response.json()) as {
      id: string;
      deleted: boolean;
    };

    spinner.succeed(`Secret deleted (${result.id})`);

    return {
      data: result,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete secret" });
    process.exit(1);
  }
};

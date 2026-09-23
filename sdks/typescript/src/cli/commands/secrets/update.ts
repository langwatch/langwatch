import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { formatFetchError } from "../../utils/formatFetchError.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";

/**
 * Returns the updated secret's metadata rather than printing it (output
 * port renders per-format). The new `--value` is not echoed back -- the
 * server doesn't return it, so a machine payload can't leak key material.
 */
export const updateSecretCommand = async (
  id: string,
  options: { value: string },
): Promise<CommandResult | void> => {
  const credentials = await resolveCredentials();
  if (!credentials.projectId) {
    throw new Error("A project must be selected for secret operations");
  }

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating secret "${id}"...`).start();

  try {
    const response = await langwatchFetch(`${endpoint}/api/v1/secret/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        projectId: credentials.projectId,
        value: options.value,
      }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "update secret" });
      process.exit(1);
    }

    const secret = (await response.json()) as {
      id: string;
      name: string;
    };

    spinner.succeed(`Secret "${secret.name}" updated`);

    return {
      data: secret,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(secret.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(secret.name)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update secret" });
    process.exit(1);
  }
};

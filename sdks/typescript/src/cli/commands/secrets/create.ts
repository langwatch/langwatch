import chalk from "chalk";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { resolveCredentials } from "../../utils/apiKey.ts";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput.ts";
import { formatFetchError } from "../../utils/formatFetchError.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";

/**
 * Return secret metadata { id, name }; never echo --value back.
 */
export const createSecretCommand = async (
  name: string,
  options: { value: string },
): Promise<CommandResult | void> => {
  const credentials = await resolveCredentials();
  if (!credentials.projectId) {
    throw new Error("A project must be selected for secret operations");
  }

  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    reportCommandError({
      error: commandValidationError(
        "Secret name must contain only uppercase letters, digits, and underscores, and must start with a letter (e.g. MY_API_KEY)",
      ),
    });
    process.exit(1);
  }

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Creating secret "${name}"...`).start();

  try {
    const response = await langwatchFetch(`${endpoint}/api/v1/secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({
        projectId: credentials.projectId,
        name,
        value: options.value,
      }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "create secret" });
      process.exit(1);
    }

    const secret = (await response.json()) as {
      id: string;
      name: string;
    };

    spinner.succeed(`Secret "${secret.name}" created (${secret.id})`);

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
    failSpinner({ spinner, error, action: "create secret" });
    process.exit(1);
  }
};

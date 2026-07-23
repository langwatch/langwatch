import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the created secret's metadata rather than printing it: the output
 * port renders it in whatever format the caller asked for (utils/output.ts).
 *
 * `data` is `{ id, name }` — the whole create response. The VALUE the caller
 * passed in `--value` is never echoed back by the server and is never put in
 * the payload here: unlike an API key or virtual key, the caller already holds
 * this secret, so there is nothing a machine caller gains from re-emitting it
 * and a great deal it risks.
 */
export const createSecretCommand = async (
  name: string,
  options: { value: string }
): Promise<CommandResult | void> => {
  checkApiKey();

  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    reportCommandError({
      error: commandValidationError(
        "Secret name must contain only uppercase letters, digits, and underscores, and must start with a letter (e.g. MY_API_KEY)",
      ),
    });
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Creating secret "${name}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/secrets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({ name, value: options.value }),
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

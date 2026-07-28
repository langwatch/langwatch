import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the updated secret's metadata rather than printing it: the output
 * port renders it in whatever format the caller asked for (utils/output.ts).
 * The new VALUE the caller passed in `--value` is not echoed into the payload
 * — the server does not return it, and a machine payload must not reintroduce
 * key material the human output never showed.
 */
export const updateSecretCommand = async (
  id: string,
  options: { value: string }
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating secret "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/secrets/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify({ value: options.value }),
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

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the secret's metadata rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts). The
 * endpoint never returns the VALUE — that is what the human view's closing
 * note says — so the raw record is metadata only and safe as a payload.
 */
export const getSecretCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(`Fetching secret "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/secrets/${id}`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch secret" });
      process.exit(1);
    }

    const secret = (await response.json()) as {
      id: string;
      name: string;
      projectId: string;
      createdAt: string;
      updatedAt: string;
    };

    spinner.succeed(`Secret "${secret.name}"`);

    return {
      data: secret,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}      ${chalk.green(secret.id)}`);
        console.log(`  ${chalk.gray("Name:")}    ${chalk.cyan(secret.name)}`);
        console.log(
          `  ${chalk.gray("Created:")} ${new Date(secret.createdAt).toLocaleString()}`
        );
        console.log(
          `  ${chalk.gray("Updated:")} ${new Date(secret.updatedAt).toLocaleString()}`
        );
        console.log();
        console.log(
          chalk.gray("  (Secret values are never returned for security)")
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch secret" });
    process.exit(1);
  }
};

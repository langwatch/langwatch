import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the revocation result rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 *
 * The service answers a bare `{ success }`, which tells a machine caller
 * nothing about WHICH key was revoked, so the id is carried alongside it.
 */
export const revokeApiKeyCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ApiKeysApiService();
  const spinner = createSpinner(`Revoking API key "${id}"...`).start();

  try {
    const result = await service.revoke(id);

    spinner.succeed(`Revoked API key "${id}"`);

    return {
      data: { id, ...result },
      table: () => {
        console.log();
        console.log(chalk.gray("API key has been revoked and can no longer be used."));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "revoke API key" });
    process.exit(1);
  }
};

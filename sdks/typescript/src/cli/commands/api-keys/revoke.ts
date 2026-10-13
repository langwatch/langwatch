import chalk from "chalk";

import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the revocation result rather than printing it (output port renders
 * per-format). The service answers a bare `{ success }`, so the id is carried
 * alongside it for a machine caller.
 */
export const revokeApiKeyCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

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

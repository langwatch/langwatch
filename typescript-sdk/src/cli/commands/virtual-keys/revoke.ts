import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the revoked key rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 */
export const revokeVirtualKeyCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Revoking virtual key "${id}"...`).start();

  try {
    const vk = await service.revoke(id);

    spinner.succeed(`Revoked virtual key "${chalk.cyan(vk.name)}"`);

    return {
      data: vk,
      table: () => {
        console.log();
        console.log(chalk.gray("Status: ") + chalk.red(vk.status));
        if (vk.revoked_at) {
          console.log(chalk.gray("Revoked at: ") + new Date(vk.revoked_at).toLocaleString());
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "revoke virtual key" });
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const revokeVirtualKeyCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new VirtualKeysApiService();
  const spinner = ora(`Revoking virtual key "${id}"...`).start();

  try {
    const vk = await service.revoke(id);

    spinner.succeed(`Revoked virtual key "${chalk.cyan(vk.name)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(vk, null, 2));
      return;
    }

    console.log();
    console.log(chalk.gray("Status: ") + chalk.red(vk.status));
    if (vk.revoked_at) {
      console.log(chalk.gray("Revoked at: ") + new Date(vk.revoked_at).toLocaleString());
    }
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "revoke virtual key" });
    process.exit(1);
  }
};

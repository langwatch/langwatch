import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const disableVirtualKeyCommand = async (
  id: string,
  options: { reason?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Disabling virtual key "${id}"...`).start();

  try {
    const vk = await service.disable(id, { reason: options.reason });

    spinner.succeed(
      `Disabled virtual key "${chalk.cyan(vk.name)}" (reversible; use enable to restore)`,
    );

    return {
      data: vk,
      table: () => {
        console.log();
        console.log(chalk.gray("Status: ") + chalk.yellow(vk.status));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "disable virtual key" });
    process.exit(1);
  }
};

export const enableVirtualKeyCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Enabling virtual key "${id}"...`).start();

  try {
    const vk = await service.enable(id);

    spinner.succeed(`Enabled virtual key "${chalk.cyan(vk.name)}"`);

    return {
      data: vk,
      table: () => {
        console.log();
        console.log(chalk.gray("Status: ") + chalk.green(vk.status));
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "enable virtual key" });
    process.exit(1);
  }
};

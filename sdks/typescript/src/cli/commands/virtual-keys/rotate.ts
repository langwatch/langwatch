import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { virtualKeyDetailUrl } from "./_shared";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the rotated key rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 *
 * `data` deliberately includes the new `secret`, for the same reason create
 * does: rotation is the only moment it exists, and the human output already
 * prints it in full. A rotate that withheld the new secret from a scripted
 * caller would break the very deployment it was rotating.
 */
export const rotateVirtualKeyCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Rotating virtual key "${id}"...`).start();

  try {
    const { virtual_key, secret } = await service.rotate(id);

    spinner.succeed(`Rotated virtual key "${chalk.cyan(virtual_key.name)}"`);

    return {
      data: { virtual_key, secret },
      table: () => {
        console.log();
        console.log(chalk.bold.yellow("⚠  New secret, save it NOW. The old secret keeps working for 24 hours."));
        console.log();
        console.log(`  ${chalk.green(secret)}`);
        console.log();
        console.log(chalk.gray("Prefix: ") + `${virtual_key.display_prefix}...`);
        const detailUrl = virtualKeyDetailUrl(virtual_key.id);
        if (detailUrl) {
          console.log(chalk.gray("View in UI: ") + chalk.cyan(detailUrl));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "rotate virtual key" });
    process.exit(1);
  }
};

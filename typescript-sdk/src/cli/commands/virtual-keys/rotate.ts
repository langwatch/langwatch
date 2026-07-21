import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { virtualKeyDetailUrl } from "./_shared";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the rotated key rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 *
 * `data` deliberately includes the new `secret`, for the same reason create
 * does: rotation is the only moment it exists, the old secret stops working
 * immediately, and the human output already prints it in full — as did the
 * previous `--format json` branch. A rotate that withheld the new secret from
 * a scripted caller would break the very deployment it was rotating.
 */
export const rotateVirtualKeyCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Rotating virtual key "${id}"...`).start();

  try {
    const { virtual_key, secret } = await service.rotate(id);

    spinner.succeed(`Rotated virtual key "${chalk.cyan(virtual_key.name)}"`);

    return {
      data: { virtual_key, secret },
      table: () => {
        console.log();
        console.log(chalk.bold.yellow("⚠  New secret — save it NOW. The old secret stops working immediately."));
        console.log();
        console.log(`  ${chalk.green(secret)}`);
        console.log();
        console.log(chalk.gray("Prefix: ") + `${virtual_key.prefix}...${virtual_key.last_four}`);
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

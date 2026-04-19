import chalk from "chalk";
import ora from "ora";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { virtualKeyDetailUrl } from "./_shared";

export const rotateVirtualKeyCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new VirtualKeysApiService();
  const spinner = ora(`Rotating virtual key "${id}"...`).start();

  try {
    const { virtual_key, secret } = await service.rotate(id);

    spinner.succeed(`Rotated virtual key "${chalk.cyan(virtual_key.name)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify({ virtual_key, secret }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold.yellow("⚠  New secret — save it NOW. The old secret stops working immediately."));
    console.log();
    console.log(`  ${chalk.green(secret)}`);
    console.log();
    console.log(chalk.gray("Prefix: ") + `${virtual_key.prefix}...${virtual_key.last_four}`);
    const detailUrl = virtualKeyDetailUrl(virtual_key.project_id, virtual_key.id);
    if (detailUrl) {
      console.log(chalk.gray("View in UI: ") + chalk.cyan(detailUrl));
    }
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "rotate virtual key" });
    process.exit(1);
  }
};

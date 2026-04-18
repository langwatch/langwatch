import chalk from "chalk";
import ora from "ora";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const getVirtualKeyCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new VirtualKeysApiService();
  const spinner = ora(`Fetching virtual key "${id}"...`).start();

  try {
    const vk = await service.get(id);

    spinner.succeed(`Fetched virtual key "${chalk.cyan(vk.name)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(vk, null, 2));
      return;
    }

    console.log();
    console.log(`${chalk.bold("ID:")}           ${vk.id}`);
    console.log(`${chalk.bold("Name:")}         ${chalk.cyan(vk.name)}`);
    if (vk.description) {
      console.log(`${chalk.bold("Description:")}  ${vk.description}`);
    }
    console.log(`${chalk.bold("Environment:")}  ${vk.environment === "live" ? chalk.yellow("live") : chalk.gray("test")}`);
    console.log(`${chalk.bold("Status:")}       ${vk.status === "ACTIVE" ? chalk.green("active") : chalk.red("revoked")}`);
    console.log(`${chalk.bold("Prefix:")}       ${vk.prefix}...${vk.last_four}`);
    console.log(`${chalk.bold("Principal:")}    ${vk.principal_user_id ?? chalk.gray("—")}`);
    console.log(`${chalk.bold("Providers:")}    ${vk.provider_credential_ids.join(", ") || chalk.gray("—")}`);
    console.log(`${chalk.bold("Created:")}      ${new Date(vk.created_at).toLocaleString()}`);
    if (vk.last_used_at) {
      console.log(`${chalk.bold("Last used:")}    ${new Date(vk.last_used_at).toLocaleString()}`);
    }
    if (vk.revoked_at) {
      console.log(`${chalk.bold("Revoked:")}      ${chalk.red(new Date(vk.revoked_at).toLocaleString())}`);
    }
    console.log();
    console.log(chalk.bold("Config:"));
    console.log(JSON.stringify(vk.config, null, 2));
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch virtual key" });
    process.exit(1);
  }
};

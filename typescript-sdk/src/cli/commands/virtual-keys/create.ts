import chalk from "chalk";
import ora from "ora";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { virtualKeyDetailUrl } from "./_shared";

export interface CreateVirtualKeyOptions {
  name: string;
  description?: string;
  env?: "live" | "test";
  provider?: string[];
  principal?: string;
  format?: string;
}

export const createVirtualKeyCommand = async (options: CreateVirtualKeyOptions): Promise<void> => {
  checkApiKey();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  const providerIds = options.provider ?? [];
  if (providerIds.length === 0) {
    console.error(chalk.red("Error: at least one --provider <id> is required"));
    console.error(chalk.gray("Hint: list available providers with `langwatch virtual-keys providers` or via the UI."));
    process.exit(1);
  }

  const service = new VirtualKeysApiService();
  const spinner = ora(`Creating virtual key "${options.name}"...`).start();

  try {
    const { virtual_key, secret } = await service.create({
      name: options.name,
      description: options.description,
      environment: options.env ?? "live",
      principal_user_id: options.principal ?? null,
      provider_credential_ids: providerIds,
    });

    spinner.succeed(`Created virtual key "${chalk.cyan(virtual_key.name)}"`);

    if (options.format === "json") {
      console.log(JSON.stringify({ virtual_key, secret }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold.yellow("⚠  Save the secret below NOW. It will not be shown again."));
    console.log();
    console.log(`  ${chalk.green(secret)}`);
    console.log();
    console.log(chalk.gray("Use it as the API key in OpenAI-compatible clients:"));
    console.log(chalk.cyan("  export OPENAI_API_KEY=\"" + secret + "\""));
    console.log(chalk.cyan("  export OPENAI_BASE_URL=\"https://gateway.langwatch.ai/v1\""));
    console.log();
    console.log(chalk.gray("Virtual key id: ") + virtual_key.id);
    console.log(chalk.gray("Prefix:         ") + `${virtual_key.prefix}...${virtual_key.last_four}`);
    const detailUrl = virtualKeyDetailUrl(virtual_key.project_id, virtual_key.id);
    if (detailUrl) {
      console.log(chalk.gray("View in UI:     ") + chalk.cyan(detailUrl));
    }
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "create virtual key" });
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export interface CreateApiKeyOptions {
  name: string;
  keyType?: "personal" | "service";
  description?: string;
  expiresAt?: string;
  projectId?: string[];
  format?: string;
}

export const createApiKeyCommand = async (options: CreateApiKeyOptions): Promise<void> => {
  checkApiKey();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  const service = new ApiKeysApiService();
  const keyType = options.keyType ?? "service";
  const spinner = ora(`Creating ${keyType} API key "${options.name}"...`).start();

  try {
    const result = await service.create({
      keyType,
      name: options.name,
      description: options.description,
      expiresAt: options.expiresAt,
      projectIds: options.projectId,
    });

    spinner.succeed(`Created ${keyType} API key "${chalk.cyan(result.apiKey.name)}"`);

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold.yellow("⚠  Save the token below NOW. It will not be shown again."));
    console.log();
    console.log(`  ${chalk.green(result.token)}`);
    console.log();
    console.log(chalk.gray("API key id: ") + result.apiKey.id);
    console.log(chalk.gray("Created:    ") + new Date(result.apiKey.createdAt).toLocaleString());
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "create API key" });
    process.exit(1);
  }
};

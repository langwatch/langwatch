import chalk from "chalk";
import ora from "ora";
import { ApiKeysApiService } from "@/client-sdk/services/api-keys/api-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const revokeApiKeyCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ApiKeysApiService();
  const spinner = ora(`Revoking API key "${id}"...`).start();

  try {
    const result = await service.revoke(id);

    spinner.succeed(`Revoked API key "${id}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.gray("API key has been revoked and can no longer be used."));
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "revoke API key" });
    process.exit(1);
  }
};

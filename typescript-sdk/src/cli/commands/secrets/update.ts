import chalk from "chalk";
import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const updateSecretCommand = async (
  id: string,
  options: { value: string; format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Updating secret "${id}"...`).start();

  try {
    const secret = (await apiRequest({
      method: "PUT",
      path: `/api/secrets/${id}`,
      apiKey,
      endpoint,
      body: { value: options.value },
    })) as {
      id: string;
      name: string;
    };

    spinner.succeed(`Secret "${secret.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(secret, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}   ${chalk.green(secret.id)}`);
    console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(secret.name)}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "update secret" });
    process.exit(1);
  }
};

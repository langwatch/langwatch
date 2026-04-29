import chalk from "chalk";
import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const getSecretCommand = async (
  id: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Fetching secret "${id}"...`).start();

  try {
    const secret = (await apiRequest({
      method: "GET",
      path: `/api/secrets/${encodeURIComponent(id)}`,
      apiKey,
      endpoint,
    })) as {
      id: string;
      name: string;
      projectId: string;
      createdAt: string;
      updatedAt: string;
    };

    spinner.succeed(`Secret "${secret.name}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(secret, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}      ${chalk.green(secret.id)}`);
    console.log(`  ${chalk.gray("Name:")}    ${chalk.cyan(secret.name)}`);
    console.log(
      `  ${chalk.gray("Created:")} ${new Date(secret.createdAt).toLocaleString()}`
    );
    console.log(
      `  ${chalk.gray("Updated:")} ${new Date(secret.updatedAt).toLocaleString()}`
    );
    console.log();
    console.log(
      chalk.gray("  (Secret values are never returned for security)")
    );
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch secret" });
    process.exit(1);
  }
};

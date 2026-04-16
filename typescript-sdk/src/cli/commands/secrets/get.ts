import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";

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
    const response = await fetch(`${endpoint}/api/secrets/${id}`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch secret: ${message}`);
      process.exit(1);
    }

    const secret = (await response.json()) as {
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
    spinner.fail();
    console.error(
      chalk.red(
        `Error: ${formatApiErrorMessage({ error })}`
      )
    );
    process.exit(1);
  }
};

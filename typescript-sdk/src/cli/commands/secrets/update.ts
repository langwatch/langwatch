import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";

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
    const response = await fetch(`${endpoint}/api/secrets/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify({ value: options.value }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to update secret: ${message}`);
      process.exit(1);
    }

    const secret = (await response.json()) as {
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
    spinner.fail();
    console.error(
      chalk.red(
        `Error: ${formatApiErrorMessage({ error })}`
      )
    );
    process.exit(1);
  }
};

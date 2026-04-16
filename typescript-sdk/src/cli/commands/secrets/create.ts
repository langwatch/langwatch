import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const createSecretCommand = async (
  name: string,
  options: { value: string; format?: string }
): Promise<void> => {
  checkApiKey();

  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error(
      chalk.red(
        "Error: Secret name must contain only uppercase letters, digits, and underscores, and must start with a letter (e.g. MY_API_KEY)"
      )
    );
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Creating secret "${name}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/secrets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify({ name, value: options.value }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to create secret: ${message}`);
      process.exit(1);
    }

    const secret = (await response.json()) as {
      id: string;
      name: string;
    };

    spinner.succeed(`Secret "${secret.name}" created (${secret.id})`);

    if (options.format === "json") {
      console.log(JSON.stringify(secret, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}   ${chalk.green(secret.id)}`);
    console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(secret.name)}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "create secret" });
    process.exit(1);
  }
};

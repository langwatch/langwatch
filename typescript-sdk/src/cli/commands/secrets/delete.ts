import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";

export const deleteSecretCommand = async (
  id: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Deleting secret "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/secrets/${id}`, {
      method: "DELETE",
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      spinner.fail(`Failed to delete secret (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
      process.exit(1);
    }

    const result = (await response.json()) as {
      id: string;
      deleted: boolean;
    };

    spinner.succeed(`Secret deleted (${result.id})`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    spinner.fail();
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    process.exit(1);
  }
};

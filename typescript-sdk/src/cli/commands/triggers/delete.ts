import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";

export const deleteTriggerCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Deleting trigger "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/triggers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      spinner.fail(response.status === 404 ? `Trigger "${id}" not found` : `Failed (${response.status})`);
      process.exit(1);
    }

    const result = await response.json() as { id: string; deleted: boolean };
    spinner.succeed(`Trigger "${id}" deleted`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    spinner.fail();
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
    process.exit(1);
  }
};

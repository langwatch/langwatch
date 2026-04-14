import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";

export const updateTriggerCommand = async (
  id: string,
  options: {
    name?: string;
    active?: string;
    message?: string;
    alertType?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Updating trigger "${id}"...`).start();

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.active !== undefined) body.active = options.active === "true";
    if (options.message !== undefined) body.message = options.message || null;
    if (options.alertType) body.alertType = options.alertType;

    if (Object.keys(body).length === 0) {
      spinner.fail("No fields to update. Use --name, --active, --message, or --alert-type.");
      process.exit(1);
    }

    const response = await fetch(`${endpoint}/api/triggers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      spinner.fail(`Failed to update trigger (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
      process.exit(1);
    }

    const trigger = await response.json() as { id: string; name: string; active: boolean };
    spinner.succeed(`Trigger "${trigger.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(trigger, null, 2));
    }
  } catch (error) {
    spinner.fail();
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
    process.exit(1);
  }
};

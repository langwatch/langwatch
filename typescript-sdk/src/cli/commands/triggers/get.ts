import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";

export const getTriggerCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Fetching trigger "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/triggers/${encodeURIComponent(id)}`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch trigger "${id}": ${message}`);
      process.exit(1);
    }

    const trigger = await response.json() as {
      id: string;
      name: string;
      action: string;
      actionParams: Record<string, unknown>;
      filters: Record<string, unknown>;
      active: boolean;
      message: string | null;
      alertType: string | null;
      createdAt: string;
      updatedAt: string;
      platformUrl?: string;
    };

    spinner.succeed(`Found trigger "${trigger.name}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(trigger, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold("  Trigger Details:"));
    console.log(`    ${chalk.gray("ID:")}      ${chalk.green(trigger.id)}`);
    console.log(`    ${chalk.gray("Name:")}    ${chalk.cyan(trigger.name)}`);
    console.log(`    ${chalk.gray("Action:")}  ${trigger.action}`);
    console.log(`    ${chalk.gray("Status:")}  ${trigger.active ? chalk.green("active") : chalk.gray("inactive")}`);
    console.log(`    ${chalk.gray("Alert:")}   ${trigger.alertType ?? chalk.gray("—")}`);
    console.log(`    ${chalk.gray("Message:")} ${trigger.message ?? chalk.gray("—")}`);
    console.log(`    ${chalk.gray("Created:")} ${new Date(trigger.createdAt).toLocaleString()}`);
    if (trigger.platformUrl) {
      console.log(`    ${chalk.bold("View:")}   ${chalk.underline(trigger.platformUrl)}`);
    }

    if (Object.keys(trigger.filters).length > 0) {
      console.log();
      console.log(chalk.bold("  Filters:"));
      console.log(`    ${JSON.stringify(trigger.filters, null, 2).split("\n").join("\n    ")}`);
    }

    console.log();
  } catch (error) {
    spinner.fail();
    console.error(chalk.red(`Error: ${formatApiErrorMessage({ error })}`));
    process.exit(1);
  }
};

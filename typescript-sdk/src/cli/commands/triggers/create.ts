import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";

export const createTriggerCommand = async (
  name: string,
  options: {
    action: string;
    filters?: string;
    message?: string;
    alertType?: string;
    slackWebhook?: string;
    format?: string;
  },
): Promise<void> => {
  checkApiKey();

  const validActions = ["SEND_EMAIL", "ADD_TO_DATASET", "ADD_TO_ANNOTATION_QUEUE", "SEND_SLACK_MESSAGE"];
  if (!validActions.includes(options.action)) {
    console.error(chalk.red(`Error: --action must be one of: ${validActions.join(", ")}`));
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Creating trigger "${name}"...`).start();

  try {
    let filters: Record<string, unknown> = {};
    if (options.filters) {
      filters = JSON.parse(options.filters) as Record<string, unknown>;
    }

    const actionParams: Record<string, unknown> = {};
    if (options.slackWebhook) actionParams.slackWebhook = options.slackWebhook;

    const response = await fetch(`${endpoint}/api/triggers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify({
        name,
        action: options.action,
        filters,
        actionParams,
        message: options.message,
        alertType: options.alertType,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      spinner.fail(`Failed to create trigger (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
      process.exit(1);
    }

    const trigger = await response.json() as { id: string; name: string; action: string; platformUrl?: string };
    spinner.succeed(`Trigger "${trigger.name}" created (${trigger.id})`);

    if (options.format === "json") {
      console.log(JSON.stringify(trigger, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}     ${chalk.green(trigger.id)}`);
    console.log(`  ${chalk.gray("Action:")} ${trigger.action}`);
    if (trigger.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(trigger.platformUrl)}`);
    }
    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof SyntaxError) {
      console.error(chalk.red("Error: --filters must be valid JSON"));
    } else {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
    }
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const getMonitorCommand = async (
  id: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Fetching monitor "${id}"...`).start();

  try {
    const response = await fetch(`${endpoint}/api/monitors/${id}`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch monitor: ${message}`);
      process.exit(1);
    }

    const monitor = (await response.json()) as {
      id: string;
      name: string;
      slug: string;
      checkType: string;
      enabled: boolean;
      executionMode: string;
      sample: number;
      level: string;
      evaluatorId: string | null;
      preconditions: unknown;
      createdAt: string;
      platformUrl?: string;
    };

    spinner.succeed(`Monitor "${monitor.name}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(monitor, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}        ${chalk.green(monitor.id)}`);
    console.log(`  ${chalk.gray("Name:")}      ${chalk.cyan(monitor.name)}`);
    console.log(`  ${chalk.gray("Slug:")}      ${monitor.slug}`);
    console.log(`  ${chalk.gray("Type:")}      ${monitor.checkType}`);
    console.log(
      `  ${chalk.gray("Status:")}    ${monitor.enabled ? chalk.green("enabled") : chalk.gray("disabled")}`
    );
    console.log(`  ${chalk.gray("Mode:")}      ${monitor.executionMode}`);
    console.log(`  ${chalk.gray("Sample:")}    ${Math.round(monitor.sample * 100)}%`);
    console.log(`  ${chalk.gray("Level:")}     ${monitor.level}`);
    if (monitor.evaluatorId) {
      console.log(
        `  ${chalk.gray("Evaluator:")} ${monitor.evaluatorId}`
      );
    }
    console.log(
      `  ${chalk.gray("Created:")}   ${new Date(monitor.createdAt).toLocaleString()}`
    );
    if (monitor.platformUrl) {
      console.log(`  ${chalk.bold("View:")}     ${chalk.underline(monitor.platformUrl)}`);
    }
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch monitor" });
    process.exit(1);
  }
};

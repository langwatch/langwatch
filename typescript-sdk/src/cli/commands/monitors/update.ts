import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const updateMonitorCommand = async (
  id: string,
  options: {
    name?: string;
    enabled?: string;
    executionMode?: string;
    sample?: string;
    parameters?: string;
    format?: string;
  }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Updating monitor "${id}"...`).start();

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.enabled !== undefined)
      body.enabled = options.enabled === "true";
    if (options.executionMode) body.executionMode = options.executionMode;
    if (options.sample) body.sample = parseFloat(options.sample);
    if (options.parameters) {
      body.parameters = JSON.parse(options.parameters) as Record<
        string,
        unknown
      >;
    }

    const response = await fetch(`${endpoint}/api/monitors/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to update monitor: ${message}`);
      process.exit(1);
    }

    const monitor = (await response.json()) as {
      id: string;
      name: string;
      enabled: boolean;
    };

    spinner.succeed(`Monitor "${monitor.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(monitor, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}      ${chalk.green(monitor.id)}`);
    console.log(`  ${chalk.gray("Name:")}    ${chalk.cyan(monitor.name)}`);
    console.log(
      `  ${chalk.gray("Enabled:")} ${monitor.enabled ? chalk.green("yes") : chalk.gray("no")}`
    );
    console.log();
  } catch (error) {
    if (error instanceof SyntaxError) {
      spinner.fail(chalk.red("--parameters must be valid JSON"));
    } else {
      failSpinner({ spinner, error, action: "update monitor" });
    }
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const createMonitorCommand = async (
  name: string,
  options: {
    checkType: string;
    executionMode?: string;
    sample?: string;
    evaluatorId?: string;
    level?: string;
    parameters?: string;
    format?: string;
  }
): Promise<void> => {
  checkApiKey();

  const validModes = ["ON_MESSAGE", "AS_GUARDRAIL", "MANUALLY"];
  if (options.executionMode && !validModes.includes(options.executionMode)) {
    console.error(
      chalk.red(`Error: --execution-mode must be one of: ${validModes.join(", ")}`)
    );
    process.exit(1);
  }

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Creating monitor "${name}"...`).start();

  try {
    let parameters: Record<string, unknown> = {};
    if (options.parameters) {
      parameters = JSON.parse(options.parameters) as Record<string, unknown>;
    }

    const response = await fetch(`${endpoint}/api/monitors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": apiKey,
      },
      body: JSON.stringify({
        name,
        checkType: options.checkType,
        executionMode: options.executionMode ?? "ON_MESSAGE",
        sample: options.sample ? parseFloat(options.sample) : 1.0,
        evaluatorId: options.evaluatorId,
        level: options.level ?? "trace",
        parameters,
        preconditions: [],
      }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to create monitor: ${message}`);
      process.exit(1);
    }

    const monitor = (await response.json()) as {
      id: string;
      name: string;
      checkType: string;
      executionMode: string;
      platformUrl?: string;
    };

    spinner.succeed(`Monitor "${monitor.name}" created (${monitor.id})`);

    if (options.format === "json") {
      console.log(JSON.stringify(monitor, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}   ${chalk.green(monitor.id)}`);
    console.log(`  ${chalk.gray("Type:")} ${monitor.checkType}`);
    console.log(`  ${chalk.gray("Mode:")} ${monitor.executionMode}`);
    if (monitor.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(monitor.platformUrl)}`);
    }
    console.log();
  } catch (error) {
    if (error instanceof SyntaxError) {
      spinner.fail(chalk.red("--parameters must be valid JSON"));
    } else {
      failSpinner({ spinner, error, action: "create monitor" });
    }
    process.exit(1);
  }
};

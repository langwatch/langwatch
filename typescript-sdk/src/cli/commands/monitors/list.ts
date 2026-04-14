import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";

export const listMonitorsCommand = async (options?: {
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora("Fetching monitors...").start();

  try {
    const response = await fetch(`${endpoint}/api/monitors`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      spinner.fail(`Failed to fetch monitors (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
      process.exit(1);
    }

    const monitors = (await response.json()) as Array<{
      id: string;
      name: string;
      checkType: string;
      enabled: boolean;
      executionMode: string;
      sample: number;
    }>;

    spinner.succeed(
      `Found ${monitors.length} monitor${monitors.length !== 1 ? "s" : ""}`
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(monitors, null, 2));
      return;
    }

    if (monitors.length === 0) {
      console.log();
      console.log(chalk.gray("No monitors found."));
      console.log(chalk.gray("Create one with:"));
      console.log(
        chalk.cyan(
          '  langwatch monitor create "Toxicity Check" --check-type ragas/toxicity'
        )
      );
      return;
    }

    console.log();

    const tableData = monitors.map((m) => ({
      Name: m.name,
      ID: m.id,
      Type: m.checkType,
      Mode: m.executionMode,
      Status: m.enabled ? chalk.green("enabled") : chalk.gray("disabled"),
      Sample: `${Math.round(m.sample * 100)}%`,
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Type", "Mode", "Status", "Sample"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
      },
    });

    console.log();
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

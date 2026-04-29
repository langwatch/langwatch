import chalk from "chalk";
import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listMonitorsCommand = async (options?: {
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora("Fetching monitors...").start();

  try {
    const monitors = (await apiRequest({
      method: "GET",
      path: "/api/monitors",
      apiKey,
      endpoint,
    })) as Array<{
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
    failSpinner({ spinner, error, action: "fetch monitors" });
    process.exit(1);
  }
};

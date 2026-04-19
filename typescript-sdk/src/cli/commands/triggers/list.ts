import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listTriggersCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora("Fetching triggers...").start();

  try {
    const response = await fetch(`${endpoint}/api/triggers`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch triggers: ${message}`);
      process.exit(1);
    }

    const triggers = await response.json() as Array<{
      id: string;
      name: string;
      action: string;
      active: boolean;
      alertType: string | null;
    }>;

    spinner.succeed(`Found ${triggers.length} trigger${triggers.length !== 1 ? "s" : ""}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(triggers, null, 2));
      return;
    }

    if (triggers.length === 0) {
      console.log();
      console.log(chalk.gray("No triggers found."));
      console.log(chalk.gray("Create one with:"));
      console.log(chalk.cyan('  langwatch trigger create "My Alert" --action SEND_EMAIL'));
      return;
    }

    console.log();

    const tableData = triggers.map((t) => ({
      Name: t.name,
      ID: t.id,
      Action: t.action,
      Status: t.active ? chalk.green("active") : chalk.gray("inactive"),
      Alert: t.alertType ?? chalk.gray("—"),
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Action", "Status", "Alert"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
      },
    });

    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch triggers" });
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listSecretsCommand = async (options?: {
  format?: string;
}): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora("Fetching secrets...").start();

  try {
    const response = await fetch(`${endpoint}/api/secrets`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to fetch secrets: ${message}`);
      process.exit(1);
    }

    const secrets = (await response.json()) as Array<{
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    }>;

    spinner.succeed(
      `Found ${secrets.length} secret${secrets.length !== 1 ? "s" : ""}`
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(secrets, null, 2));
      return;
    }

    if (secrets.length === 0) {
      console.log();
      console.log(chalk.gray("No secrets found."));
      console.log(chalk.gray("Create one with:"));
      console.log(
        chalk.cyan('  langwatch secret create MY_API_KEY --value "sk-..."')
      );
      return;
    }

    console.log();

    const tableData = secrets.map((s) => ({
      Name: s.name,
      ID: s.id,
      Updated: new Date(s.updatedAt).toLocaleDateString(),
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Updated"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
      },
    });

    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch secrets" });
    process.exit(1);
  }
};

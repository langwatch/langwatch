import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";

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
      const errorBody = await response.text();
      spinner.fail(`Failed to fetch secrets (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
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
    spinner.fail();
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
    process.exit(1);
  }
};

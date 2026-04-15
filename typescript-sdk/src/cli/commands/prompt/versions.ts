import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";

export const promptVersionsCommand = async (
  handle: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Fetching versions for "${handle}"...`).start();

  try {
    const response = await fetch(
      `${endpoint}/api/prompts/${encodeURIComponent(handle)}/versions`,
      {
        headers: { "X-Auth-Token": apiKey },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      spinner.fail(`Failed to fetch versions (${response.status})`);
      console.error(chalk.red(`Error: ${errorBody}`));
      process.exit(1);
    }

    const versions = (await response.json()) as Array<{
      id: string;
      version: number;
      commitMessage: string | null;
      createdAt: string;
    }>;

    spinner.succeed(
      `Found ${versions.length} version${versions.length !== 1 ? "s" : ""} for "${handle}"`
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(versions, null, 2));
      return;
    }

    if (versions.length === 0) {
      console.log();
      console.log(chalk.gray("No versions found."));
      return;
    }

    console.log();

    const tableData = versions.map((v) => ({
      Version: `v${v.version}`,
      ID: v.id,
      Message: v.commitMessage ?? chalk.gray("—"),
      Created: new Date(v.createdAt).toLocaleString(),
    }));

    formatTable({
      data: tableData,
      headers: ["Version", "ID", "Message", "Created"],
      colorMap: {
        Version: chalk.cyan,
        ID: chalk.green,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `  Tip: Restore a version with: langwatch prompt restore ${handle} <versionId>`
      )
    );
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

import chalk from "chalk";
import ora from "ora";
import { PromptsApiService, PromptsError } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";

export const promptVersionsCommand = async (
  handle: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const service = new PromptsApiService();

  const spinner = ora(`Fetching versions for "${handle}"...`).start();

  try {
    const versions = await service.getVersions(handle);

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
      ID: v.versionId,
      Tags:
        v.tags && v.tags.length > 0
          ? v.tags.map((t) => t.name).join(", ")
          : chalk.gray("—"),
      Message: v.commitMessage ?? chalk.gray("—"),
      Created: new Date(v.createdAt).toLocaleString(),
    }));

    formatTable({
      data: tableData,
      headers: ["Version", "ID", "Tags", "Message", "Created"],
      colorMap: {
        Version: chalk.cyan,
        ID: chalk.green,
        Tags: chalk.magenta,
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
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      );
    }
    process.exit(1);
  }
};

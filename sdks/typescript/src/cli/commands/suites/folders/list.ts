import chalk from "chalk";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { createSpinner } from "../../../utils/spinner";
import { resolveCredentials } from "../../../utils/apiKey";
import { formatTable } from "../../../utils/formatting";
import { failSpinner } from "../../../utils/spinnerError";
import type { CommandResult } from "../../../utils/output";

/**
 * The project's test suite folders. Run plans are a different kind of suite
 * and are listed by `langwatch suite list`.
 */
export const listFoldersCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new SuitesApiService();
  const spinner = createSpinner("Fetching test suite folders...").start();

  try {
    const folders = await service.getAll({ kind: "folder" });

    spinner.succeed(
      `Found ${folders.length} test suite folder${folders.length !== 1 ? "s" : ""}`,
    );

    return {
      data: folders,
      table: () => {
        if (folders.length === 0) {
          console.log();
          console.log(chalk.gray("No test suite folders found in this project."));
          console.log(chalk.gray("Create your first folder with:"));
          console.log(chalk.cyan('  langwatch suite folder create "Refunds"'));
          return;
        }

        console.log();

        const tableData = folders.map((folder) => ({
          Name: folder.name,
          ID: folder.id,
          Slug: folder.slug,
          "Scenarios": `${folder.scenarioIds.length}`,
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Slug", "Scenarios"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
            Slug: chalk.yellow,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `File a scenario into one with ${chalk.cyan("langwatch scenario update <id> --folder <folder>")}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch test suite folders" });
    process.exit(1);
  }
};

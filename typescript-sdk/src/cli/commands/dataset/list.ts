import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/format";
import { DatasetsCliService, DatasetsCliServiceError } from "./datasets-cli.service";

export const datasetListCommand = async (): Promise<void> => {
  checkApiKey();

  const service = new DatasetsCliService();
  const spinner = ora("Fetching datasets...").start();

  try {
    const result = await service.list();
    const datasets = result.data;

    spinner.succeed(
      `Found ${datasets.length} dataset${datasets.length !== 1 ? "s" : ""}` +
        (result.pagination.total > datasets.length
          ? chalk.gray(` (${result.pagination.total} total)`)
          : ""),
    );

    if (datasets.length === 0) {
      console.log();
      console.log(chalk.gray("No datasets found."));
      console.log(chalk.gray("Create your first dataset with:"));
      console.log(chalk.cyan("  langwatch dataset create <name>"));
      return;
    }

    console.log();

    const tableData = datasets.map((ds) => ({
      Name: ds.name,
      Slug: ds.slug,
      Records: String(ds.recordCount ?? 0),
      Updated: formatRelativeTime(ds.updatedAt),
    }));

    formatTable(tableData, ["Name", "Slug", "Records", "Updated"], {
      Name: chalk.cyan,
      Records: chalk.green,
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch dataset get <slug>")} to view a dataset`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof DatasetsCliServiceError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching datasets: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

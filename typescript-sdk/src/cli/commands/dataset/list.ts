import chalk from "chalk";
import ora from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { createDatasetService } from "./service-factory";

/**
 * Lists all datasets for the current project.
 * Displays a table with name, slug, record count, and last updated.
 */
export const listCommand = async (): Promise<void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = ora("Fetching datasets...").start();

  try {
    const result = await service.listDatasets();
    const { data: datasets, pagination } = result;

    spinner.succeed(
      `Found ${pagination.total} dataset${pagination.total !== 1 ? "s" : ""}`,
    );

    if (datasets.length === 0) {
      console.log();
      console.log(chalk.gray("No datasets found."));
      console.log(chalk.gray("Create your first dataset with:"));
      console.log(
        chalk.cyan('  langwatch dataset create "My Dataset" --columns input:string,output:string'),
      );
      return;
    }

    console.log();

    const tableData = datasets.map((ds) => ({
      Name: ds.name,
      Slug: ds.slug,
      Records: String(ds.recordCount),
      Updated: ds.updatedAt ? formatRelativeTime(ds.updatedAt) : "N/A",
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "Slug", "Records", "Updated"],
      colorMap: { Name: chalk.cyan },
    });

    if (pagination.totalPages > 1) {
      console.log();
      console.log(
        chalk.gray(
          `Showing page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total)`,
        ),
      );
    }
  } catch (error) {
    spinner.fail("Failed to fetch datasets");

    if (error instanceof DatasetNotFoundError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else if (error instanceof DatasetApiError) {
      console.error(chalk.red(`API Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

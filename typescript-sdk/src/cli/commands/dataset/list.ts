import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Lists all datasets for the current project.
 * Displays a table with name, slug, record count, and last updated.
 */
export const listCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = ora("Fetching datasets...").start();

  try {
    const result = await service.listDatasets();
    const { data: datasets, pagination } = result;

    spinner.succeed(
      `Found ${pagination.total} dataset${pagination.total !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify({ data: datasets, pagination }, null, 2));
      return;
    }

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
    handleDatasetCommandError({ spinner, error, context: "list datasets" });
  }
};

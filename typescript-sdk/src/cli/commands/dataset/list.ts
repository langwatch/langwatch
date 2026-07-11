import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { createCommandEvents } from "../../telemetry/events";
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
  // The same live-event vocabulary as `trace search`, on a different resource:
  // the panel needs no new code to light up for datasets.
  const events = createCommandEvents({ resource: "dataset", verb: "list" });

  try {
    events.started("Fetching datasets…");

    const result = await service.listDatasets();
    const { data: datasets, pagination } = result;

    events.count({
      count: pagination.total,
      total: pagination.total,
      message: `${pagination.total.toLocaleString()} dataset${pagination.total === 1 ? "" : "s"}`,
    });

    spinner.succeed(
      `Found ${pagination.total} dataset${pagination.total !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify({ data: datasets, pagination }, null, 2));
    } else if (datasets.length === 0) {
      console.log();
      console.log(chalk.gray("No datasets found."));
      console.log(chalk.gray("Create your first dataset with:"));
      console.log(
        chalk.cyan('  langwatch dataset create "My Dataset" --columns input:string,output:string'),
      );
    } else {
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
    }

    events.completed({
      count: datasets.length,
      total: pagination.total,
      message: `Returned ${datasets.length} of ${pagination.total.toLocaleString()} dataset${pagination.total === 1 ? "" : "s"}`,
    });
  } catch (error) {
    events.failed({ error, message: "Dataset list failed" });
    // `handleDatasetCommandError` exits the process, so flush first.
    await events.flush();
    handleDatasetCommandError({ spinner, error, context: "list datasets" });
  } finally {
    await events.flush();
  }
};

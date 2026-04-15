import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Gets dataset details by slug or ID, showing metadata and a preview of records.
 */
export const getCommand = async (slugOrId: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = ora(`Fetching dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.getDataset(slugOrId);

    spinner.succeed(`Dataset: ${chalk.cyan(dataset.name)}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(dataset, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.bold("Slug:")}       ${dataset.slug}`);
    console.log(`  ${chalk.bold("ID:")}         ${dataset.id}`);

    if (dataset.columnTypes.length > 0) {
      const colStr = dataset.columnTypes
        .map((c) => `${c.name}:${c.type}`)
        .join(", ");
      console.log(`  ${chalk.bold("Columns:")}    ${colStr}`);
    }

    console.log(`  ${chalk.bold("Records:")}    ${dataset.entries.length}`);

    if (dataset.createdAt) {
      console.log(
        `  ${chalk.bold("Created:")}    ${formatRelativeTime(dataset.createdAt)}`,
      );
    }
    if (dataset.updatedAt) {
      console.log(
        `  ${chalk.bold("Updated:")}    ${formatRelativeTime(dataset.updatedAt)}`,
      );
    }
    const viewUrl = (dataset as Record<string, unknown>).platformUrl as string | undefined;
    if (viewUrl) {
      console.log(`  ${chalk.bold("View:")}       ${chalk.underline(viewUrl)}`);
    }

    // Show a preview of the first 10 records
    if (dataset.entries.length > 0) {
      console.log();
      console.log(chalk.bold("Preview (first 10 records):"));

      const previewEntries = dataset.entries.slice(0, 10);

      // Collect all keys from entries
      const allKeys = new Set<string>();
      previewEntries.forEach((entry) => {
        Object.keys(entry.entry).forEach((key) => allKeys.add(key));
      });
      const headers = Array.from(allKeys);

      const tableData = previewEntries.map((entry) => {
        const row: Record<string, string> = {};
        headers.forEach((key) => {
          const value = entry.entry[key];
          row[key] =
            value === null || value === undefined
              ? ""
              : typeof value === "string"
                ? value.length > 50
                  ? value.substring(0, 47) + "..."
                  : value
                : JSON.stringify(value).substring(0, 50);
        });
        return row;
      });

      formatTable({ data: tableData, headers });

      if (dataset.entries.length > 10) {
        console.log(
          chalk.gray(
            `  ... and ${dataset.entries.length - 10} more record(s)`,
          ),
        );
      }
    }
  } catch (error) {
    spinner.fail("Failed to fetch dataset");
    handleDatasetCommandError(error, "fetching dataset");
  }
};

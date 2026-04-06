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
 * Gets dataset details by slug or ID, showing metadata and a preview of records.
 */
export const getCommand = async (slugOrId: string): Promise<void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = ora(`Fetching dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.getDataset(slugOrId);

    spinner.succeed(`Dataset: ${chalk.cyan(dataset.name)}`);
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

      formatTable(tableData, headers);

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

    if (error instanceof DatasetNotFoundError) {
      console.error(chalk.red(`Dataset not found: ${slugOrId}`));
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

import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/**
 * Truncates a string to a maximum length, adding ellipsis if truncated.
 */
const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength - 3) + "...";
};

/**
 * Lists records in a dataset with pagination.
 */
export const recordsListCommand = async (
  slugOrId: string,
  options: { page?: string; limit?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const page = options.page ? parseInt(options.page, 10) : 1;
  const limit = options.limit ? parseInt(options.limit, 10) : 20;

  if (Number.isNaN(page) || page < 1) {
    console.error(chalk.red("Error: --page must be a positive integer."));
    process.exit(1);
  }
  if (Number.isNaN(limit) || limit < 1) {
    console.error(chalk.red("Error: --limit must be a positive integer."));
    process.exit(1);
  }

  const service = createDatasetService();
  const spinner = ora(`Fetching records from "${slugOrId}"...`).start();

  try {
    const result = await service.listRecords(slugOrId, { page, limit });
    const { data: records, pagination } = result;

    spinner.succeed(
      `Found ${pagination.total} record${pagination.total !== 1 ? "s" : ""} in "${slugOrId}"`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify({ data: records, pagination }, null, 2));
      return;
    }

    if (records.length === 0) {
      console.log();
      console.log(chalk.gray("No records found."));
      return;
    }

    // Collect all keys from record entries
    const entryKeys = new Set<string>();
    records.forEach((record) => {
      Object.keys(record.entry).forEach((key) => entryKeys.add(key));
    });
    const headers = ["ID", ...Array.from(entryKeys)];

    const tableData = records.map((record) => {
      const row: Record<string, string> = { ID: record.id };
      entryKeys.forEach((key) => {
        const value = record.entry[key];
        const str =
          value === null || value === undefined
            ? ""
            : typeof value === "string"
              ? value
              : JSON.stringify(value);
        row[key] = truncate(str, 40);
      });
      return row;
    });

    console.log();
    formatTable({ data: tableData, headers, colorMap: { ID: chalk.gray } });

    console.log();
    console.log(
      chalk.gray(
        `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total records)`,
      ),
    );
  } catch (error) {
    handleDatasetCommandError({ spinner, error, context: "list records" });
  }
};

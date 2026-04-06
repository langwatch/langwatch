import chalk from "chalk";
import ora from "ora";
import type { DatasetRecordResponse } from "@/client-sdk/services/datasets/types";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";

/**
 * Escapes a value for inclusion in a CSV field.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
export const escapeCsvField = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Converts records to CSV format.
 *
 * @param records - Array of dataset record responses
 * @returns CSV string with header row
 */
export const toCsv = (records: DatasetRecordResponse[]): string => {
  if (records.length === 0) return "";

  // Collect all keys from all entries
  const allKeys = new Set<string>();
  records.forEach((record) => {
    Object.keys(record.entry).forEach((key) => allKeys.add(key));
  });
  const headers = Array.from(allKeys);

  const headerRow = headers.map(escapeCsvField).join(",");
  const dataRows = records.map((record) =>
    headers.map((key) => escapeCsvField(record.entry[key])).join(","),
  );

  return [headerRow, ...dataRows].join("\n");
};

/**
 * Converts records to JSONL format (one JSON object per line).
 */
export const toJsonl = (records: DatasetRecordResponse[]): string => {
  return records.map((record) => JSON.stringify(record.entry)).join("\n");
};

/**
 * Downloads all records from a dataset and outputs as CSV or JSONL to stdout.
 */
export const downloadCommand = async (
  slugOrId: string,
  options: { format?: string },
): Promise<void> => {
  checkApiKey();

  const format = options.format ?? "csv";
  if (format !== "csv" && format !== "jsonl") {
    console.error(
      chalk.red(`Invalid format "${format}". Use "csv" or "jsonl".`),
    );
    process.exit(1);
  }

  const service = createDatasetService();
  const spinner = ora(
    `Downloading dataset "${slugOrId}" as ${format.toUpperCase()}...`,
  ).start();

  try {
    // Fetch all records by paging through results
    const allRecords: DatasetRecordResponse[] = [];
    let page = 1;
    const limit = 1000;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (true) {
      const result = await service.listRecords(slugOrId, { page, limit });
      allRecords.push(...result.data);

      if (page >= result.pagination.totalPages) {
        break;
      }
      page++;
    }

    spinner.stop();

    // Output to stdout
    if (format === "csv") {
      const output = toCsv(allRecords);
      if (output) {
        process.stdout.write(output + "\n");
      }
    } else {
      const output = toJsonl(allRecords);
      if (output) {
        process.stdout.write(output + "\n");
      }
    }

    // Summary to stderr so it doesn't pollute piped output
    process.stderr.write(
      chalk.green(
        `Downloaded ${allRecords.length} record${allRecords.length !== 1 ? "s" : ""} from "${slugOrId}"\n`,
      ),
    );
  } catch (error) {
    spinner.fail("Failed to download dataset");

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

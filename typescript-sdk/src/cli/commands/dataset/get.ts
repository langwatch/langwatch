import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

/** How many records the human table previews before it says "and N more". */
const PREVIEW_LIMIT = 10;

/** Longest cell the preview renders before it truncates with an ellipsis. */
const MAX_CELL_LENGTH = 50;

/**
 * The previewed records, shaped for `formatTable`.
 *
 * Dataset rows are free-form, so the header set is the UNION of every key seen
 * in the preview window rather than the first row's keys — otherwise a row with
 * an extra field renders that field nowhere. Cells are truncated because a
 * single oversized value would push every other column off the terminal.
 */
const buildDatasetPreviewRows = (
  entries: readonly { entry: Record<string, unknown> }[],
): { headers: string[]; tableData: Record<string, string>[] } => {
  const previewEntries = entries.slice(0, PREVIEW_LIMIT);

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
            ? value.length > MAX_CELL_LENGTH
              ? value.substring(0, MAX_CELL_LENGTH - 3) + "..."
              : value
            : JSON.stringify(value).substring(0, MAX_CELL_LENGTH);
    });
    return row;
  });

  return { headers, tableData };
};

/**
 * Gets dataset details by slug or ID, showing metadata and a preview of records.
 */
export const getCommand = async (slugOrId: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = createDatasetService();
  const spinner = createSpinner(`Fetching dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.getDataset(slugOrId);

    spinner.succeed(`Dataset: ${chalk.cyan(dataset.name)}`);

    return {
      data: dataset,
      table: () => {
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
        const viewUrl = dataset.platformUrl;
        if (viewUrl) {
          console.log(`  ${chalk.bold("View:")}       ${chalk.underline(viewUrl)}`);
        }

        if (dataset.entries.length > 0) {
          console.log();
          console.log(chalk.bold(`Preview (first ${PREVIEW_LIMIT} records):`));

          const { headers, tableData } = buildDatasetPreviewRows(dataset.entries);
          formatTable({ data: tableData, headers });

          if (dataset.entries.length > PREVIEW_LIMIT) {
            console.log(
              chalk.gray(
                `  ... and ${dataset.entries.length - PREVIEW_LIMIT} more record(s)`,
              ),
            );
          }
        }
      },
    };
  } catch (error) {
    handleDatasetCommandError({ spinner, error, context: "fetch dataset" });
  }
};

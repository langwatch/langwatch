import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { DatasetsCliService, DatasetsCliServiceError } from "./datasets-cli.service";

const SUPPORTED_FORMATS = ["csv", "jsonl"] as const;
type DownloadFormat = (typeof SUPPORTED_FORMATS)[number];

export function escapeCsvField(value: unknown): string {
  const str =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(records: Array<{ entry: Record<string, unknown> }>): string {
  if (records.length === 0) return "";

  // Build column list from union of all record keys to avoid dropping columns
  const columnSet = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.entry)) {
      columnSet.add(key);
    }
  }
  const columns = [...columnSet];

  const header = columns.map((col) => escapeCsvField(col)).join(",");
  const rows = records.map((record) =>
    columns.map((col) => escapeCsvField(record.entry[col])).join(","),
  );

  return [header, ...rows].join("\n");
}

export function toJsonl(records: Array<{ entry: Record<string, unknown> }>): string {
  return records.map((record) => JSON.stringify(record.entry)).join("\n");
}

export const datasetDownloadCommand = async ({
  slugOrId,
  options,
}: {
  slugOrId: string;
  options: { format?: string };
}): Promise<void> => {
  checkApiKey();

  const format = options.format ?? "csv";
  if (!SUPPORTED_FORMATS.includes(format as DownloadFormat)) {
    console.error(
      chalk.red(`Unsupported format "${format}". Use "csv" or "jsonl".`),
    );
    process.exit(1);
  }

  const service = new DatasetsCliService();
  const spinner = ora(`Fetching dataset "${slugOrId}"...`).start();

  try {
    const records = await service.getAllRecords(slugOrId);

    spinner.stop();

    if (records.length === 0) {
      process.stderr.write(
        chalk.yellow(`Dataset "${slugOrId}" has no records.\n`),
      );
      return;
    }

    const output = format === "csv" ? toCsv(records) : toJsonl(records);
    process.stdout.write(output + "\n");
  } catch (error) {
    spinner.fail();
    if (
      error instanceof DatasetsCliServiceError &&
      error.status === 404
    ) {
      console.error(chalk.red(`Dataset "${slugOrId}" not found.`));
    } else if (error instanceof DatasetsCliServiceError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error downloading dataset: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

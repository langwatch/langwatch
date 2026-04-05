import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { DatasetsCliService, DatasetsCliServiceError } from "./datasets-cli.service";

const PREVIEW_LIMIT = 10;

export const datasetGetCommand = async (slugOrId: string): Promise<void> => {
  checkApiKey();

  const service = new DatasetsCliService();
  const spinner = ora(`Fetching dataset "${slugOrId}"...`).start();

  try {
    const dataset = await service.get(slugOrId);

    spinner.succeed(`Dataset: ${chalk.cyan(dataset.name)}`);
    console.log();
    console.log(`  ${chalk.bold("Slug:")}       ${dataset.slug}`);
    console.log(`  ${chalk.bold("ID:")}         ${dataset.id}`);

    const columns = dataset.columnTypes ?? [];
    if (columns.length > 0) {
      console.log(
        `  ${chalk.bold("Columns:")}    ${columns.map((c) => `${c.name}:${c.type}`).join(", ")}`,
      );
    }

    const records = dataset.data ?? [];
    console.log(`  ${chalk.bold("Records:")}    ${records.length}`);
    console.log(
      `  ${chalk.bold("Created:")}    ${new Date(dataset.createdAt).toLocaleString()}`,
    );
    console.log(
      `  ${chalk.bold("Updated:")}    ${new Date(dataset.updatedAt).toLocaleString()}`,
    );

    if (records.length > 0) {
      console.log();
      console.log(
        chalk.bold(
          `Preview (first ${Math.min(records.length, PREVIEW_LIMIT)} records):`,
        ),
      );
      console.log();

      const previewRecords = records.slice(0, PREVIEW_LIMIT);
      const columnNames =
        columns.length > 0
          ? columns.map((c) => c.name)
          : Object.keys(previewRecords[0]?.entry ?? {});

      if (columnNames.length > 0) {
        // Calculate column widths
        const colWidths: Record<string, number> = {};
        columnNames.forEach((col) => {
          colWidths[col] = Math.max(
            col.length,
            ...previewRecords.map((r) => {
              const val = r.entry[col];
              const str =
                val === undefined
                  ? ""
                  : typeof val === "string"
                    ? val
                    : JSON.stringify(val);
              return Math.min(str.length, 40);
            }),
          );
        });

        // Header
        const headerRow = columnNames
          .map((col) => chalk.bold(col.padEnd(colWidths[col]!)))
          .join("  ");
        console.log(`  ${headerRow}`);

        const separator = columnNames
          .map((col) => "─".repeat(colWidths[col]!))
          .join("  ");
        console.log(`  ${chalk.gray(separator)}`);

        // Rows
        previewRecords.forEach((record) => {
          const row = columnNames
            .map((col) => {
              const val = record.entry[col];
              let str =
                val === undefined
                  ? ""
                  : typeof val === "string"
                    ? val
                    : JSON.stringify(val);
              if (str.length > 40) str = str.slice(0, 37) + "...";
              return chalk.gray(str.padEnd(colWidths[col]!));
            })
            .join("  ");
          console.log(`  ${row}`);
        });

        if (records.length > PREVIEW_LIMIT) {
          console.log();
          console.log(
            chalk.gray(
              `  ... and ${records.length - PREVIEW_LIMIT} more records`,
            ),
          );
        }
      }
    }
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
          `Error fetching dataset: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

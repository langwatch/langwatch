import chalk from "chalk";
import ora from "ora";
import type { DatasetColumnType } from "@/client-sdk/services/datasets/types";
import {
  DatasetApiError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";

/**
 * Parses a comma-separated column spec string into DatasetColumnType[].
 *
 * @param columnsStr - Format: "name:type,name:type" (e.g. "input:string,output:string")
 * @returns Parsed column type definitions
 * @throws Error if the format is invalid
 */
export const parseColumns = (columnsStr: string): DatasetColumnType[] => {
  return columnsStr.split(",").map((pair) => {
    const parts = pair.trim().split(":");
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new Error(
        `Invalid column format: "${pair.trim()}". Expected "name:type" (e.g. "input:string")`,
      );
    }
    return { name: parts[0].trim(), type: parts[1].trim() };
  });
};

/**
 * Creates a new dataset with the given name and optional column types.
 */
export const createCommand = async (
  name: string,
  options: { columns?: string },
): Promise<void> => {
  checkApiKey();

  let columnTypes: DatasetColumnType[] = [];
  if (options.columns) {
    try {
      columnTypes = parseColumns(options.columns);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : "Invalid columns format"),
      );
      process.exit(1);
    }
  }

  const service = createDatasetService();
  const spinner = ora(`Creating dataset "${name}"...`).start();

  try {
    const dataset = await service.createDataset({ name, columnTypes });

    spinner.succeed(`Dataset created: ${chalk.cyan(dataset.slug)}`);
    console.log();
    console.log(`  ${chalk.bold("ID:")}    ${dataset.id}`);
    console.log(`  ${chalk.bold("Slug:")}  ${dataset.slug}`);
    if (dataset.columnTypes.length > 0) {
      const colStr = dataset.columnTypes
        .map((c) => `${c.name}:${c.type}`)
        .join(", ");
      console.log(`  ${chalk.bold("Columns:")} ${colStr}`);
    }
  } catch (error) {
    spinner.fail("Failed to create dataset");

    if (error instanceof DatasetApiError && error.status === 409) {
      console.error(
        chalk.red("A dataset with this name already exists. Choose a different name."),
      );
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

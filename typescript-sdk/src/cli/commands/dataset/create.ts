import chalk from "chalk";
import ora from "ora";
import type { DatasetColumnType } from "@/client-sdk/services/datasets/types";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

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
  options: { columns?: string; format?: string },
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

    if (options.format === "json") {
      console.log(JSON.stringify(dataset, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.bold("ID:")}    ${dataset.id}`);
    console.log(`  ${chalk.bold("Slug:")}  ${dataset.slug}`);
    if (dataset.columnTypes.length > 0) {
      const colStr = dataset.columnTypes
        .map((c) => `${c.name}:${c.type}`)
        .join(", ");
      console.log(`  ${chalk.bold("Columns:")} ${colStr}`);
    }
    const viewUrl = dataset.platformUrl;
    if (viewUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(viewUrl)}`);
    }
  } catch (error) {
    spinner.fail("Failed to create dataset");
    handleDatasetCommandError(error, "creating dataset");
  }
};

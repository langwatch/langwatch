import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import {
  DatasetsCliService,
  DatasetsCliServiceError,
  type DatasetColumnType,
} from "./datasets-cli.service";

function parseColumns(columnsStr: string): DatasetColumnType[] {
  return columnsStr.split(",").map((col) => {
    const [name, type] = col.trim().split(":");
    if (!name || !type) {
      throw new Error(
        `Invalid column format: "${col.trim()}". Expected "name:type" (e.g., input:string)`,
      );
    }
    return { name: name.trim(), type: type.trim() };
  });
}

export const datasetCreateCommand = async (
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
        chalk.red(error instanceof Error ? error.message : "Invalid columns"),
      );
      process.exit(1);
    }
  }

  const service = new DatasetsCliService();
  const spinner = ora(`Creating dataset "${name}"...`).start();

  try {
    const dataset = await service.create({ name, columnTypes });

    spinner.succeed(`Dataset created: ${chalk.cyan(dataset.name)}`);
    console.log();
    console.log(`  ${chalk.bold("Slug:")}  ${dataset.slug}`);
    console.log(`  ${chalk.bold("ID:")}    ${dataset.id}`);
    if (columnTypes.length > 0) {
      console.log(
        `  ${chalk.bold("Columns:")} ${columnTypes.map((c) => `${c.name}:${c.type}`).join(", ")}`,
      );
    }
    console.log();
    console.log(
      chalk.gray(
        `Upload data with: ${chalk.cyan(`langwatch dataset upload ${dataset.slug} data.csv`)}`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (
      error instanceof DatasetsCliServiceError &&
      error.status === 409
    ) {
      console.error(
        chalk.red(`A dataset with this name already exists.`),
      );
    } else if (error instanceof DatasetsCliServiceError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error creating dataset: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

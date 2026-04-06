import { readFileSync } from "fs";
import { basename } from "path";
import chalk from "chalk";
import ora from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
} from "@/client-sdk/services/datasets/errors";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";

/**
 * Uploads a file to a dataset with a configurable strategy for handling existing datasets.
 *
 * Usage:
 * - Append (default):  `langwatch dataset upload <slug> <file>`
 * - Replace:           `langwatch dataset upload <slug> <file> --if-exists replace`
 * - Error if exists:   `langwatch dataset upload <slug> <file> --if-exists error`
 */
export const uploadCommand = async (
  slugOrId: string,
  filePath: string,
  options?: { ifExists?: string },
): Promise<void> => {
  checkApiKey();

  if (!filePath) {
    console.error(chalk.red("Error: File path is required"));
    process.exit(1);
  }

  const ifExists = (options?.ifExists ?? "append") as "append" | "replace" | "error";
  const validStrategies = ["append", "replace", "error"];
  if (!validStrategies.includes(ifExists)) {
    console.error(
      chalk.red(`Error: --if-exists must be one of: ${validStrategies.join(", ")}`),
    );
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    console.error(chalk.red(`Error: Cannot read file "${filePath}"`));
    process.exit(1);
  }

  const filename = basename(filePath);
  const file = new File([content], filename);

  const service = createDatasetService();

  const strategyLabel = ifExists === "append"
    ? "Uploading"
    : ifExists === "replace"
      ? "Replacing records and uploading"
      : "Uploading (error if exists)";

  const spinner = ora(
    `${strategyLabel} ${filename} to dataset "${slugOrId}"...`,
  ).start();

  try {
    const result = await service.uploadWithStrategy(slugOrId, file, ifExists);

    const recordCount = result.records?.length ?? result.recordsCreated ?? 0;

    if (result.dataset) {
      spinner.succeed(
        `Dataset "${chalk.cyan(result.dataset.name)}" ready with ${recordCount} record${recordCount !== 1 ? "s" : ""}`,
      );
      console.log();
      console.log(`  ${chalk.bold("Slug:")}    ${result.dataset.slug}`);
      console.log(`  ${chalk.bold("ID:")}      ${result.dataset.id}`);
    } else {
      spinner.succeed(
        `Uploaded ${filename} to "${chalk.cyan(slugOrId)}" (${recordCount} record${recordCount !== 1 ? "s" : ""})`,
      );
    }
  } catch (error) {
    spinner.fail("Failed to upload file");

    if (error instanceof DatasetNotFoundError) {
      console.error(chalk.red(`Dataset not found: ${slugOrId}`));
    } else if (error instanceof DatasetApiError && error.status === 409) {
      console.error(
        chalk.red(
          `Dataset "${slugOrId}" already exists. Use --if-exists append or --if-exists replace.`,
        ),
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

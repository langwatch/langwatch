import { readFileSync } from "fs";
import { basename } from "path";
import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { createDatasetService } from "./service-factory";
import { handleDatasetCommandError } from "./error-handler";

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

    const recordCount = result.recordsCreated ?? result.records?.length ?? "unknown";

    if (result.dataset) {
      spinner.succeed(
        `Dataset "${chalk.cyan(result.dataset.name)}" ready with ${recordCount} record${recordCount !== 1 ? "s" : ""}`,
      );
      console.log();
      console.log(`  ${chalk.bold("Slug:")}    ${result.dataset.slug}`);
      console.log(`  ${chalk.bold("ID:")}      ${result.dataset.id}`);
      if (result.dataset.platformUrl) {
        console.log(`  ${chalk.bold("View:")}    ${chalk.underline(result.dataset.platformUrl)}`);
      }
    } else {
      spinner.succeed(
        `Uploaded ${filename} to "${chalk.cyan(slugOrId)}" (${recordCount} record${recordCount !== 1 ? "s" : ""})`,
      );
    }
  } catch (error) {
    spinner.fail("Failed to upload file");
    handleDatasetCommandError(error, "uploading file");
  }
};

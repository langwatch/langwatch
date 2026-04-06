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
 * Uploads a file to an existing dataset or creates a new dataset from a file.
 *
 * Modes:
 * - Upload to existing: `langwatch dataset upload <slug> <file>`
 * - Create from file:   `langwatch dataset upload --create <name> <file>`
 */
export const uploadCommand = async (
  target: string,
  filePathOrOptions: string | { create?: string },
  options?: { create?: string },
): Promise<void> => {
  checkApiKey();

  // Determine mode: --create or upload to existing
  const isCreateMode = typeof filePathOrOptions === "object"
    ? !!filePathOrOptions.create
    : !!options?.create;

  let filePath: string;
  let slugOrId: string | undefined;
  let datasetName: string | undefined;

  if (isCreateMode) {
    // `langwatch dataset upload --create "Name" <file>`
    // target is the file path when --create is used with just one positional arg
    // OR target is the name and filePathOrOptions is the file
    datasetName = (typeof filePathOrOptions === "object"
      ? filePathOrOptions.create
      : options?.create) ?? target;
    filePath = typeof filePathOrOptions === "string" ? filePathOrOptions : target;
  } else {
    // `langwatch dataset upload <slug> <file>`
    slugOrId = target;
    filePath = typeof filePathOrOptions === "string" ? filePathOrOptions : "";
  }

  if (!filePath) {
    console.error(chalk.red("Error: File path is required"));
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

  if (isCreateMode && datasetName) {
    const spinner = ora(
      `Creating dataset "${datasetName}" from ${filename}...`,
    ).start();

    try {
      const result = await service.createDatasetFromUpload({
        name: datasetName,
        file,
      });

      spinner.succeed(
        `Dataset "${chalk.cyan(result.name)}" created from ${filename}`,
      );
      console.log();
      console.log(`  ${chalk.bold("Slug:")}    ${result.slug}`);
      console.log(`  ${chalk.bold("ID:")}      ${result.id}`);
      console.log(`  ${chalk.bold("Records:")} ${result.recordsCreated}`);
    } catch (error) {
      spinner.fail("Failed to create dataset from file");

      if (error instanceof DatasetApiError && error.status === 409) {
        console.error(
          chalk.red(
            "A dataset with this name already exists. Choose a different name.",
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
  } else if (slugOrId) {
    const spinner = ora(
      `Uploading ${filename} to dataset "${slugOrId}"...`,
    ).start();

    try {
      const result = await service.uploadFile(slugOrId, file);
      const recordCount = result.records?.length ?? 0;

      spinner.succeed(
        `Uploaded ${filename} to "${chalk.cyan(slugOrId)}" (${recordCount} record${recordCount !== 1 ? "s" : ""})`,
      );
    } catch (error) {
      spinner.fail("Failed to upload file");

      if (error instanceof DatasetNotFoundError) {
        console.error(chalk.red(`Dataset not found: ${slugOrId}`));
      } else if (error instanceof DatasetApiError && error.status === 409) {
        console.error(
          chalk.red("Conflict: the upload conflicts with existing data."),
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
  }
};

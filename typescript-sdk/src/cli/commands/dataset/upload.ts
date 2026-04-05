import chalk from "chalk";
import ora from "ora";
import { readFileSync } from "fs";
import { basename } from "path";
import { checkApiKey } from "../../utils/apiKey";
import { DatasetsCliService, DatasetsCliServiceError } from "./datasets-cli.service";

export const datasetUploadCommand = async ({
  slugOrIdOrFile,
  filePath: filePathOrUndefined,
  options,
}: {
  slugOrIdOrFile: string;
  filePath: string | undefined;
  options: { create?: string };
}): Promise<void> => {
  checkApiKey();

  const service = new DatasetsCliService();

  // Determine if this is --create mode or upload-to-existing mode
  const isCreateMode = !!options.create;
  const filePath = isCreateMode ? slugOrIdOrFile : filePathOrUndefined;
  const slugOrId = isCreateMode ? undefined : slugOrIdOrFile;
  const createName = options.create;

  if (!filePath) {
    console.error(chalk.red("Error: file path is required."));
    console.error(
      chalk.gray(
        "Usage: langwatch dataset upload <slug> <file> or langwatch dataset upload --create <name> <file>",
      ),
    );
    process.exit(1);
  }

  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, "utf-8");
  } catch {
    console.error(chalk.red(`Error: Cannot read file "${filePath}"`));
    process.exit(1);
  }

  const filename = basename(filePath);

  if (isCreateMode && createName) {
    const spinner = ora(
      `Creating dataset "${createName}" from ${filename}...`,
    ).start();

    try {
      const result = await service.createFromUpload({
        name: createName,
        content: fileContent,
        filename,
      });

      spinner.succeed(
        `Dataset "${chalk.cyan(result.name ?? createName)}" created from ${filename}`,
      );
      console.log();
      console.log(`  ${chalk.bold("Slug:")}    ${result.slug}`);
      console.log(`  ${chalk.bold("ID:")}      ${result.id}`);
      console.log(`  ${chalk.bold("Records:")} ${result.recordCount ?? "uploaded"}`);
    } catch (error) {
      spinner.fail();
      if (
        error instanceof DatasetsCliServiceError &&
        error.status === 409
      ) {
        console.error(
          chalk.red("A dataset with this name already exists."),
        );
      } else if (error instanceof DatasetsCliServiceError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(
          chalk.red(
            `Error uploading: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      const result = await service.uploadToExisting({
        slugOrId,
        content: fileContent,
        filename,
      });

      spinner.succeed(
        `Uploaded ${filename} to "${slugOrId}" (${result.uploadedCount} records)`,
      );
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
            `Error uploading: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
        );
      }
      process.exit(1);
    }
  }
};

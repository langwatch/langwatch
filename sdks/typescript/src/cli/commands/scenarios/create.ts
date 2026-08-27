import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliScenariosService } from "./cli-scenarios-service";
import {
  FolderReferenceError,
  resolveFolderReference,
} from "../suites/folders/resolveFolder";

export const createScenarioCommand = async (
  name: string,
  options: {
    situation: string;
    criteria?: string;
    labels?: string;
    folder?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // The folder is resolved before anything is created, so a folder that names
  // nothing leaves no half-filed scenario behind.
  let folderId: string | undefined;
  let folderName: string | undefined;
  if (options.folder !== undefined) {
    try {
      const folder = await resolveFolderReference({ reference: options.folder });
      folderId = folder.id;
      folderName = folder.name;
    } catch (error) {
      if (error instanceof FolderReferenceError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }
  }

  const service = createCliScenariosService();
  const spinner = createSpinner(`Creating scenario "${name}"...`).start();

  try {
    const criteria = options.criteria
      ? options.criteria.split(",").map((c) => c.trim())
      : [];
    const labels = options.labels ? options.labels.split(",").map((l) => l.trim()) : [];

    const scenario = await service.create({
      name,
      situation: options.situation,
      criteria,
      labels,
      ...(folderId !== undefined && { folderId }),
    });

    spinner.succeed(
      folderName
        ? `Created scenario "${chalk.cyan(scenario.name)}" in folder "${chalk.cyan(folderName)}" ${chalk.gray(`(id: ${scenario.id})`)}`
        : `Created scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    return {
      data: scenario,
      table: () => {
        if (scenario.platformUrl) {
          console.log(
            `  ${chalk.bold("View:")}  ${chalk.underline(scenario.platformUrl)}`,
          );
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create scenario" });
    process.exit(1);
  }
};

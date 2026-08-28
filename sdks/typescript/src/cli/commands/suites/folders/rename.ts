import chalk from "chalk";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { createSpinner } from "../../../utils/spinner";
import { resolveCredentials } from "../../../utils/apiKey";
import { failSpinner } from "../../../utils/spinnerError";
import type { CommandResult } from "../../../utils/output";
import { FolderReferenceError, resolveFolderReference } from "./resolveFolder";

/**
 * Renames a test suite folder. The folder keeps its slug: its run history and
 * its platform address are read through it.
 */
export const renameFolderCommand = async (
  folderRef: string,
  name: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new SuitesApiService();

  let folderId: string;
  try {
    const folder = await resolveFolderReference({
      reference: folderRef,
      service,
    });
    folderId = folder.id;
  } catch (error) {
    if (error instanceof FolderReferenceError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  const spinner = createSpinner(`Renaming test suite folder "${folderRef}"...`).start();

  try {
    const folder = await service.update(folderId, { name });

    spinner.succeed(
      `Renamed test suite folder to "${chalk.cyan(folder.name)}" ${chalk.gray(`(id: ${folder.id})`)}`,
    );

    return {
      data: folder,
      table: () => {
        // The spinner's success line is the whole human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "rename test suite folder" });
    process.exit(1);
  }
};

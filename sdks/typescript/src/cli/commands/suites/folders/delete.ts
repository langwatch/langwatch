import chalk from "chalk";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { createSpinner } from "../../../utils/spinner";
import { resolveCredentials } from "../../../utils/apiKey";
import { failSpinner } from "../../../utils/spinnerError";
import type { CommandResult } from "../../../utils/output";
import { FolderReferenceError, resolveFolderReference } from "./resolveFolder";

/**
 * Archives a test suite folder and every test case filed in it.
 *
 * The platform archives rather than erases, so the folder and its cases stay
 * readable and their run history is kept.
 */
export const deleteFolderCommand = async (
  folderRef: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new SuitesApiService();

  let folderId: string;
  let folderName: string;
  let caseCount: number;
  try {
    const folder = await resolveFolderReference({
      reference: folderRef,
      service,
    });
    folderId = folder.id;
    folderName = folder.name;
    caseCount = folder.scenarioIds.length;
  } catch (error) {
    if (error instanceof FolderReferenceError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  const spinner = createSpinner(
    `Archiving test suite folder "${folderName}"...`,
  ).start();

  try {
    const result = await service.delete(folderId);

    spinner.succeed(
      caseCount > 0
        ? `Test suite folder "${folderName}" archived, with its ${caseCount} test case${caseCount !== 1 ? "s" : ""}`
        : `Test suite folder "${folderName}" archived`,
    );

    return {
      data: { ...result, name: folderName, archivedScenarioCount: caseCount },
      table: () => {
        // The spinner's success line is the whole human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive test suite folder" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import type { UpdateScenarioBody } from "@/client-sdk/services/scenarios";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliScenariosService } from "./cli-scenarios-service";
import {
  resolveSuiteReference,
  SuiteReferenceError,
} from "../test-suites/resolveSuite";

export const updateScenarioCommand = async (
  id: string,
  options: {
    name?: string;
    situation?: string;
    criteria?: string;
    labels?: string;
    folder?: string;
    noFolder?: boolean;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // One of the two says where the case goes, so a line carrying both says two
  // different things. It is refused before the scenario is touched.
  if (options.folder !== undefined && options.noFolder) {
    console.error(
      chalk.red("Error: --folder and --no-folder cannot be used together."),
    );
    process.exit(1);
  }

  let folderId: string | null | undefined;
  let folderName: string | undefined;
  if (options.folder !== undefined) {
    try {
      const folder = await resolveSuiteReference({ reference: options.folder });
      folderId = folder.id;
      folderName = folder.name;
    } catch (error) {
      if (error instanceof SuiteReferenceError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }
  } else if (options.noFolder) {
    folderId = null;
  }

  const service = createCliScenariosService();
  const spinner = createSpinner(`Updating scenario "${id}"...`).start();

  try {
    const body: UpdateScenarioBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.situation !== undefined) body.situation = options.situation;
    if (options.criteria !== undefined)
      body.criteria = options.criteria.split(",").map((c) => c.trim());
    if (options.labels !== undefined)
      body.labels = options.labels.split(",").map((l) => l.trim());
    if (folderId !== undefined) body.folderId = folderId;

    const scenario = await service.update(id, body);

    const movement =
      folderId === null
        ? " (no folder)"
        : folderName
          ? ` (folder: ${folderName})`
          : "";
    spinner.succeed(
      `Updated scenario "${chalk.cyan(scenario.name)}"${movement} ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    return {
      data: scenario,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update scenario" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the archived project rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteProjectCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ProjectsApiService();
  const spinner = createSpinner(`Archiving project "${id}"...`).start();

  try {
    const result = await service.archive(id);

    spinner.succeed(`Archived project "${chalk.cyan(result.name)}"`);

    return {
      data: result,
      table: () => {
        console.log();
        console.log(chalk.gray("Project has been archived (soft-deleted)."));
        console.log(chalk.gray("Archived at: ") + new Date(result.archivedAt).toLocaleString());
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive project" });
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const deleteProjectCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ProjectsApiService();
  const spinner = ora(`Archiving project "${id}"...`).start();

  try {
    const result = await service.archive(id);

    spinner.succeed(`Archived project "${chalk.cyan(result.name)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.gray("Project has been archived (soft-deleted)."));
    console.log(chalk.gray("Archived at: ") + new Date(result.archivedAt).toLocaleString());
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "archive project" });
    process.exit(1);
  }
};

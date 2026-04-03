import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { DatasetsCliService, DatasetsCliServiceError } from "./datasets-cli.service";

export const datasetDeleteCommand = async (slugOrId: string): Promise<void> => {
  checkApiKey();

  const service = new DatasetsCliService();
  const spinner = ora(`Archiving dataset "${slugOrId}"...`).start();

  try {
    await service.delete(slugOrId);
    spinner.succeed(`Dataset "${slugOrId}" archived successfully.`);
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
          `Error deleting dataset: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

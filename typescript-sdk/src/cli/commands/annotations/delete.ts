import chalk from "chalk";
import ora from "ora";
import {
  AnnotationsApiService,
  AnnotationsApiError,
} from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const deleteAnnotationCommand = async (id: string): Promise<void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = ora(`Deleting annotation "${id}"...`).start();

  try {
    await service.delete(id);
    spinner.succeed(`Deleted annotation "${chalk.cyan(id)}"`);
  } catch (error) {
    spinner.fail();
    if (error instanceof AnnotationsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error deleting annotation: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

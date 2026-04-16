import chalk from "chalk";
import ora from "ora";
import {
  AnnotationsApiService,
  AnnotationsApiError,
} from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const deleteAnnotationCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = ora(`Deleting annotation "${id}"...`).start();

  try {
    await service.delete(id);
    spinner.succeed(`Deleted annotation "${chalk.cyan(id)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify({ id, deleted: true }, null, 2));
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof AnnotationsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error deleting annotation: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};

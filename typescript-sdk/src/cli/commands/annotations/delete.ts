import chalk from "chalk";
import ora from "ora";
import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "delete annotation" });
    process.exit(1);
  }
};

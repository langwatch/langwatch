import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the deletion outcome rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteAnnotationCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = createSpinner(`Deleting annotation "${id}"...`).start();

  try {
    await service.delete(id);
    spinner.succeed(`Deleted annotation "${chalk.cyan(id)}"`);

    return {
      data: { id, deleted: true },
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "delete annotation" });
    process.exit(1);
  }
};

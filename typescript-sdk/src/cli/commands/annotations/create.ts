import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the created annotation rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createAnnotationCommand = async (
  traceId: string,
  options: { comment?: string; thumbsUp?: boolean; thumbsDown?: boolean; email?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = createSpinner(`Creating annotation for trace "${traceId}"...`).start();

  try {
    const isThumbsUp =
      options.thumbsUp === true
        ? true
        : options.thumbsDown === true
          ? false
          : undefined;

    const annotation = await service.create(traceId, {
      comment: options.comment,
      isThumbsUp,
      email: options.email,
    });

    const ratingStr =
      isThumbsUp === true ? " 👍" : isThumbsUp === false ? " 👎" : "";

    spinner.succeed(
      `Created annotation${ratingStr} ${chalk.gray(`(id: ${annotation.id ?? "—"})`)}`,
    );

    return {
      data: annotation,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create annotation" });
    process.exit(1);
  }
};

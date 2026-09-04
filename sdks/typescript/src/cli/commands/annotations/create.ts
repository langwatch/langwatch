import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the created annotation rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createAnnotationCommand = async (
  traceId: string,
  options: { comment?: string; thumbsUp?: boolean; thumbsDown?: boolean; email?: string },
): Promise<CommandResult | void> => {
  // Both are hard server requirements (routes/annotations.ts), so refuse
  // before credential resolution rather than after a network round trip.
  if (!options.comment) {
    reportCommandError({
      error: commandValidationError(
        "--comment is required: an annotation without a comment is rejected by the API.\n" +
          '  langwatch annotation create <traceId> --comment "Great response!" --thumbs-up',
      ),
    });
    process.exit(1);
  }
  if (options.thumbsUp !== true && options.thumbsDown !== true) {
    reportCommandError({
      error: commandValidationError(
        "One of --thumbs-up or --thumbs-down is required: the API stores a rating with every annotation.",
      ),
    });
    process.exit(1);
  }

  await resolveCredentials();

  const service = new AnnotationsApiService();
  const spinner = createSpinner(`Creating annotation for trace "${traceId}"...`).start();

  try {
    const isThumbsUp = options.thumbsUp === true;

    const annotation = await service.create(traceId, {
      comment: options.comment,
      isThumbsUp,
      email: options.email,
    });

    const ratingStr = isThumbsUp ? " 👍" : " 👎";

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

import chalk from "chalk";
import ora from "ora";
import {
  AnnotationsApiService,
  AnnotationsApiError,
} from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const createAnnotationCommand = async (
  traceId: string,
  options: { comment?: string; thumbsUp?: boolean; thumbsDown?: boolean; email?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = ora(`Creating annotation for trace "${traceId}"...`).start();

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

    if (options.format === "json") {
      console.log(JSON.stringify(annotation, null, 2));
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof AnnotationsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error creating annotation: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "create annotation" });
    process.exit(1);
  }
};

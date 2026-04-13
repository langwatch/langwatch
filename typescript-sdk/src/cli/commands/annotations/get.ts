import chalk from "chalk";
import ora from "ora";
import {
  AnnotationsApiService,
  AnnotationsApiError,
} from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const getAnnotationCommand = async (id: string): Promise<void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = ora(`Fetching annotation "${id}"...`).start();

  try {
    const annotation = await service.get(id);
    spinner.succeed(`Found annotation "${id}"`);

    console.log();
    console.log(chalk.bold.cyan(`Annotation ${annotation.id ?? id}`));
    console.log(chalk.gray("─".repeat(40)));
    console.log(`  ${chalk.gray("ID:")}        ${annotation.id ?? "—"}`);
    console.log(`  ${chalk.gray("Trace ID:")} ${annotation.traceId ?? "—"}`);
    console.log(
      `  ${chalk.gray("Rating:")}   ${annotation.isThumbsUp === true ? "👍 Thumbs Up" : annotation.isThumbsUp === false ? "👎 Thumbs Down" : "—"}`,
    );
    if (annotation.email) {
      console.log(`  ${chalk.gray("Email:")}    ${annotation.email}`);
    }
    if (annotation.createdAt) {
      console.log(
        `  ${chalk.gray("Created:")}  ${new Date(annotation.createdAt).toLocaleString()}`,
      );
    }
    if (annotation.updatedAt) {
      console.log(
        `  ${chalk.gray("Updated:")}  ${new Date(annotation.updatedAt).toLocaleString()}`,
      );
    }

    if (annotation.comment) {
      console.log();
      console.log(chalk.bold("  Comment:"));
      console.log(`    ${annotation.comment}`);
    }

    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof AnnotationsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching annotation: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

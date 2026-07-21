import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AnnotationsApiService } from "@/client-sdk/services/annotations/annotations-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the annotation rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getAnnotationCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AnnotationsApiService();
  const spinner = createSpinner(`Fetching annotation "${id}"...`).start();

  try {
    const annotation = await service.get(id);
    spinner.succeed(`Found annotation "${id}"`);

    return {
      data: annotation,
      table: () => {
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
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch annotation" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface UpdateProjectOptions {
  name?: string;
  language?: string;
  framework?: string;
  piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
}

/**
 * Returns the updated project rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const updateProjectCommand = async (
  id: string,
  options: UpdateProjectOptions,
): Promise<CommandResult | void> => {
  checkApiKey();

  const noFieldsProvided =
    options.name === undefined &&
    options.language === undefined &&
    options.framework === undefined &&
    options.piiRedactionLevel === undefined;

  if (noFieldsProvided) {
    console.error(
      chalk.red(
        "Error: nothing to update. Provide at least one of --name, --language, --framework, --pii-redaction-level.",
      ),
    );
    process.exit(1);
  }

  const service = new ProjectsApiService();
  const spinner = createSpinner(`Updating project "${id}"...`).start();

  try {
    const updated = await service.update(id, {
      name: options.name,
      language: options.language,
      framework: options.framework,
      piiRedactionLevel: options.piiRedactionLevel,
    });

    spinner.succeed(`Updated project "${chalk.cyan(updated.name)}"`);

    return {
      data: updated,
      table: () => {
        console.log();
        console.log(`${chalk.bold("ID:")}              ${updated.id}`);
        console.log(`${chalk.bold("Name:")}            ${chalk.cyan(updated.name)}`);
        console.log(`${chalk.bold("Slug:")}            ${updated.slug}`);
        console.log(`${chalk.bold("Language:")}        ${updated.language}`);
        console.log(`${chalk.bold("Framework:")}       ${updated.framework}`);
        console.log(`${chalk.bold("PII Redaction:")}   ${updated.piiRedactionLevel}`);
        console.log(`${chalk.bold("Updated:")}         ${new Date(updated.updatedAt).toLocaleString()}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update project" });
    process.exit(1);
  }
};

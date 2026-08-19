import chalk from "chalk";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Returns the project rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getProjectCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ProjectsApiService();
  const spinner = createSpinner(`Fetching project "${id}"...`).start();

  try {
    const project = await service.get(id);

    spinner.succeed(`Fetched project "${chalk.cyan(project.name)}"`);

    return {
      data: project,
      table: () => {
        console.log();
        console.log(`${chalk.bold("ID:")}              ${project.id}`);
        console.log(
          `${chalk.bold("Name:")}            ${chalk.cyan(project.name)}`,
        );
        console.log(`${chalk.bold("Slug:")}            ${project.slug}`);
        console.log(`${chalk.bold("Language:")}        ${project.language}`);
        console.log(`${chalk.bold("Framework:")}       ${project.framework}`);
        console.log(`${chalk.bold("Team ID:")}         ${project.teamId}`);
        console.log(
          `${chalk.bold("PII Redaction:")}   ${project.piiRedactionLevel}`,
        );
        console.log(
          `${chalk.bold("Created:")}         ${new Date(project.createdAt).toLocaleString()}`,
        );
        console.log(
          `${chalk.bold("Updated:")}         ${new Date(project.updatedAt).toLocaleString()}`,
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch project" });
    process.exit(1);
  }
};

import chalk from "chalk";
import ora from "ora";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const getProjectCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new ProjectsApiService();
  const spinner = ora(`Fetching project "${id}"...`).start();

  try {
    const project = await service.get(id);

    spinner.succeed(`Fetched project "${chalk.cyan(project.name)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(project, null, 2));
      return;
    }

    console.log();
    console.log(`${chalk.bold("ID:")}              ${project.id}`);
    console.log(`${chalk.bold("Name:")}            ${chalk.cyan(project.name)}`);
    console.log(`${chalk.bold("Slug:")}            ${project.slug}`);
    console.log(`${chalk.bold("Language:")}        ${project.language}`);
    console.log(`${chalk.bold("Framework:")}       ${project.framework}`);
    console.log(`${chalk.bold("Team ID:")}         ${project.teamId}`);
    console.log(`${chalk.bold("PII Redaction:")}   ${project.piiRedactionLevel}`);
    console.log(`${chalk.bold("Created:")}         ${new Date(project.createdAt).toLocaleString()}`);
    console.log(`${chalk.bold("Updated:")}         ${new Date(project.updatedAt).toLocaleString()}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch project" });
    process.exit(1);
  }
};

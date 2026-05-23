import chalk from "chalk";
import ora from "ora";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export interface CreateProjectOptions {
  name: string;
  language: string;
  framework: string;
  teamId?: string;
  newTeamName?: string;
  format?: string;
}

export const createProjectCommand = async (options: CreateProjectOptions): Promise<void> => {
  checkApiKey();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }
  if (!options.language) {
    console.error(chalk.red("Error: --language is required"));
    process.exit(1);
  }
  if (!options.framework) {
    console.error(chalk.red("Error: --framework is required"));
    process.exit(1);
  }
  if (!options.teamId && !options.newTeamName) {
    console.error(chalk.red("Error: either --team-id or --new-team-name is required"));
    process.exit(1);
  }

  const service = new ProjectsApiService();
  const spinner = ora(`Creating project "${options.name}"...`).start();

  try {
    const project = await service.create({
      name: options.name,
      language: options.language,
      framework: options.framework,
      teamId: options.teamId,
      newTeamName: options.newTeamName,
    });

    spinner.succeed(`Created project "${chalk.cyan(project.name)}"`);

    if (options.format === "json") {
      console.log(JSON.stringify(project, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold.yellow("⚠  Save the service API key below NOW. It will not be shown again."));
    console.log();
    console.log(`  ${chalk.green(project.serviceApiKey)}`);
    console.log();
    console.log(chalk.gray("Use it to authenticate project-scoped operations:"));
    console.log(chalk.cyan(`  export LANGWATCH_API_KEY="${project.serviceApiKey}"`));
    console.log();
    console.log(chalk.gray("Project id:         ") + project.id);
    console.log(chalk.gray("Slug:               ") + project.slug);
    console.log(chalk.gray("Service API key id: ") + project.serviceApiKeyId);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "create project" });
    process.exit(1);
  }
};

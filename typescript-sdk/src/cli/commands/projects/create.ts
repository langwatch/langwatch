import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ProjectsApiService } from "@/client-sdk/services/projects/projects-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface CreateProjectOptions {
  name: string;
  language: string;
  framework: string;
  teamId?: string;
  newTeamName?: string;
}

/**
 * Returns the created project rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 *
 * `data` is the raw project, which includes the one-time `serviceApiKey`. That
 * is the whole point of the create response — the server never returns the key
 * again — so both the human output and the previous `--format json` branch
 * emitted it in full, and a scripted caller needs it to be usable at all.
 */
export const createProjectCommand = async (
  options: CreateProjectOptions,
): Promise<CommandResult | void> => {
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
  const spinner = createSpinner(`Creating project "${options.name}"...`).start();

  try {
    const project = await service.create({
      name: options.name,
      language: options.language,
      framework: options.framework,
      teamId: options.teamId,
      newTeamName: options.newTeamName,
    });

    spinner.succeed(`Created project "${chalk.cyan(project.name)}"`);

    // The service API key is one-time — the server never returns it again — so
    // the warning must reach the caller in EVERY format, not only the table.
    // stderr keeps it outside the machine document, so a parser reading stdout
    // is unaffected while the human still gets told.
    process.stderr.write(
      "warning: the service API key is shown once and cannot be retrieved again — save it now.\n",
    );

    return {
      data: project,
      table: () => {
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
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create project" });
    process.exit(1);
  }
};

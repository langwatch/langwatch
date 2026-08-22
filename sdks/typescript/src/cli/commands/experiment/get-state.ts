import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface ExperimentGetStateOptions {
  fields?: string;
}

export const experimentGetStateCommand = async (
  slug: string,
  options: ExperimentGetStateOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const versionOnly = options.fields === "version";

  const service = new ExperimentsApiService();
  const spinner = createSpinner(
    versionOnly
      ? `Checking version of "${slug}"...`
      : `Fetching setup for "${slug}"...`,
  ).start();

  try {
    const workbench = versionOnly
      ? await service.getWorkbenchState({ slug, fields: "version" })
      : await service.getWorkbenchState({ slug });

    spinner.succeed(`"${slug}" is at version ${chalk.cyan(workbench.version)}`);

    return {
      data: workbench,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("Slug:")}     ${chalk.green(workbench.slug)}`);
        console.log(`  ${chalk.gray("Version:")}  ${workbench.version}`);
        console.log(`  ${chalk.gray("Updated:")}  ${workbench.updatedAt}`);
        console.log();
        if (versionOnly) return;
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("--format json")} to read the full setup, and ${chalk.cyan(
              `langwatch experiment set-state ${slug} --file <path>`,
            )} to save it back.`,
          ),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch experiment setup" });
    process.exit(1);
  }
};

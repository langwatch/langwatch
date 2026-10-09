import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export interface ExperimentCreateOptions {
  name?: string;
}

export const experimentCreateCommand = async (
  options: ExperimentCreateOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ExperimentsApiService();
  const spinner = createSpinner("Creating experiment...").start();

  try {
    // No setup is sent: the platform builds the blank workbench, so the CLI
    // does not carry a second definition of what "empty" means.
    const created = await service.create({
      ...(options.name ? { name: options.name } : {}),
    });

    spinner.succeed(`Experiment created: ${chalk.green(created.slug)}`);

    return {
      data: created,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("Slug:")}    ${chalk.green(created.slug)}`);
        console.log(`  ${chalk.gray("Id:")}      ${created.id}`);
        console.log(`  ${chalk.gray("Version:")} ${created.version}`);
        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan(`langwatch experiment get-state ${created.slug}`)} to read its setup.`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create experiment" });
    process.exit(1);
  }
};

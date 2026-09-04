import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliTestSuitesService } from "./cli-test-suites-service";

/**
 * Creates an empty test suite. Scenarios join it by being filed into it, and
 * the targets a run goes against travel with the run.
 *
 * @see specs/features/test-suite-cli.feature
 */
export const createTestSuiteCommand = async (
  name: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const spinner = createSpinner(`Creating test suite "${name}"...`).start();

  try {
    const suite = await service.create({ name });

    spinner.succeed(`Test suite "${suite.name}" created (${suite.id})`);

    return {
      data: suite,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}        ${chalk.green(suite.id)}`);
        console.log(`  ${chalk.gray("Slug:")}      ${chalk.yellow(suite.slug)}`);
        console.log(`  ${chalk.gray("Scenarios:")} ${suite.scenarioCount}`);
        console.log();
        console.log(
          chalk.gray(
            `File a scenario into it with: ${chalk.cyan(`langwatch scenario create "<name>" --situation "<situation>" --test-suite ${suite.id}`)}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create test suite" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliTestSuitesService } from "./cli-test-suites-service";
import { resolveSuiteId } from "./resolveSuite";

/**
 * Reads one test suite, named by ID or by name.
 *
 * @see specs/features/suite-cli.feature
 */
export const getTestSuiteCommand = async (
  reference: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const id = await resolveSuiteId({ reference, service });
  const spinner = createSpinner(`Fetching test suite "${reference}"...`).start();

  try {
    const suite = await service.get(id);

    spinner.succeed(`Found test suite "${suite.name}"`);

    return {
      data: suite,
      table: () => {
        console.log();
        console.log(chalk.bold("  Test Suite:"));
        console.log(`    ${chalk.gray("ID:")}        ${chalk.green(suite.id)}`);
        console.log(`    ${chalk.gray("Name:")}      ${chalk.cyan(suite.name)}`);
        console.log(`    ${chalk.gray("Slug:")}      ${chalk.yellow(suite.slug)}`);
        console.log(`    ${chalk.gray("Scenarios:")} ${suite.scenarioCount}`);

        if (suite.scenarios.length > 0) {
          console.log();
          console.log(chalk.bold("  Scenarios:"));
          for (const scenario of suite.scenarios) {
            console.log(
              `    ${chalk.gray("•")} ${scenario.name} ${chalk.gray(`(${scenario.id})`)}`,
            );
          }
        }

        if (suite.platformUrl) {
          console.log();
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(suite.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "get test suite" });
    process.exit(1);
  }
};

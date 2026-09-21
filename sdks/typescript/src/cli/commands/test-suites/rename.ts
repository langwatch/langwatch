import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliTestSuitesService } from "./cli-test-suites-service";
import { resolveSuiteId } from "./resolveSuite";

/**
 * Renames a test suite. The slug is kept, so links and run history stay where
 * they are.
 *
 * @see specs/features/test-suite-cli.feature
 */
export const renameTestSuiteCommand = async (
  reference: string,
  name: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const id = await resolveSuiteId({ reference, service });
  const spinner = createSpinner(`Renaming test suite "${reference}"...`).start();

  try {
    const suite = await service.rename(id, { name });

    spinner.succeed(`Test suite renamed to "${suite.name}"`);

    return {
      data: suite,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(suite.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(suite.name)}`);
        console.log(`  ${chalk.gray("Slug:")} ${chalk.yellow(suite.slug)}`);
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "rename test suite" });
    process.exit(1);
  }
};

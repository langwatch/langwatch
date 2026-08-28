import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliTestSuitesService } from "./cli-test-suites-service";
import { resolveSuiteId } from "./resolveSuite";

/**
 * Archives a test suite. The scenarios filed in it are archived with it, in
 * one step, because the suite is where they live.
 *
 * @see specs/features/suite-cli.feature
 */
export const archiveTestSuiteCommand = async (
  reference: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const id = await resolveSuiteId({ reference, service });
  const spinner = createSpinner(`Archiving test suite "${reference}"...`).start();

  try {
    const result = await service.archive(id);

    spinner.succeed(`Test suite "${id}" archived`);

    return {
      data: result,
      table: () => {
        console.log();
        console.log(
          chalk.gray("  The scenarios filed in it were archived with it."),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive test suite" });
    process.exit(1);
  }
};

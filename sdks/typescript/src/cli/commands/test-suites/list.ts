import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliTestSuitesService } from "./cli-test-suites-service";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 *
 * @see specs/features/suite-cli.feature
 */
export const listTestSuitesCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  const spinner = createSpinner("Fetching test suites...").start();

  try {
    const suites = await service.list();

    spinner.succeed(
      `Found ${suites.length} test suite${suites.length !== 1 ? "s" : ""}`,
    );

    return {
      data: suites,
      table: () => {
        if (suites.length === 0) {
          console.log();
          console.log(chalk.gray("No test suites found in this project."));
          console.log(chalk.gray("Create your first one with:"));
          console.log(chalk.cyan('  langwatch suite create "Refunds"'));
          return;
        }

        console.log();

        formatTable({
          data: suites.map((suite) => ({
            Name: suite.name,
            ID: suite.id,
            Slug: suite.slug,
            Scenarios: `${suite.scenarioCount}`,
          })),
          headers: ["Name", "ID", "Slug", "Scenarios"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
            Slug: chalk.yellow,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Run one with ${chalk.cyan("langwatch suite run <id> --target http:<agentId>")}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "list test suites" });
    process.exit(1);
  }
};

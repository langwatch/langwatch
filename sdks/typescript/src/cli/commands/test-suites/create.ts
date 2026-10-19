import chalk from "chalk";

import { resolveCredentials } from "../../utils/apiKey.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { parseSuiteFieldDefinitionFlags } from "../../utils/suiteFieldFlags.ts";
import { createCliTestSuitesService } from "./cli-test-suites-service.ts";
import { type EvaluatorFlagRef, readEvaluators } from "./evaluatorFlags.ts";
import { printEvaluators, printSuiteFields } from "./renderSuiteDetails.ts";

export interface CreateTestSuiteOptions {
  /** `--field identifier:type`, one per occurrence. */
  field?: string[];
  /** `--evaluator <id|slug>`, in the order written, each with its gate flag. */
  evaluators?: EvaluatorFlagRef[];
  /** `--evaluators-json <file|json>`: the full attachment list. */
  evaluatorsJson?: string;
}

/**
 * Creates a test suite with no scenarios -- they join by being filed into
 * it, and a run's targets travel with the run. Fields and evaluators can be
 * given on creation.
 * @see specs/features/test-suite-cli.feature
 */
export const createTestSuiteCommand = async (
  name: string,
  options: CreateTestSuiteOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // Everything the caller wrote is read before anything is created, so a
  // malformed flag or an evaluator that is not there leaves no suite behind.
  const fields = parseSuiteFieldDefinitionFlags({ pairs: options.field });
  const evaluators = await readEvaluators({ options, fields: fields ?? [] });

  const service = createCliTestSuitesService();
  const spinner = createSpinner(`Creating test suite "${name}"...`).start();

  try {
    const suite = await service.create({
      name,
      ...(fields !== undefined ? { fields } : {}),
      ...(evaluators !== undefined ? { evaluators } : {}),
    });

    spinner.succeed(`Test suite "${suite.name}" created (${suite.id})`);

    return {
      data: suite,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}        ${chalk.green(suite.id)}`);
        console.log(`  ${chalk.gray("Slug:")}      ${chalk.yellow(suite.slug)}`);
        console.log(`  ${chalk.gray("Scenarios:")} ${suite.scenarioCount}`);
        printSuiteFields(suite.fields);
        printEvaluators(suite.evaluators);
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

import chalk from "chalk";
import type { UpdateTestSuiteBody } from "@/client-sdk/services/test-suites";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import { parseSuiteFieldDefinitionFlags } from "../../utils/suiteFieldFlags";
import { createCliTestSuitesService } from "./cli-test-suites-service";
import { type EvaluatorFlagRef, readEvaluators } from "./evaluatorFlags";
import { printEvaluators, printSuiteFields } from "./renderSuiteDetails";
import { resolveSuiteReference, SuiteReferenceError } from "./resolveSuite";

export interface UpdateTestSuiteOptions {
  name?: string;
  /** `--field identifier:type`, one per occurrence. Given, it replaces the list. */
  field?: string[];
  /** `--evaluator <id|slug>`, in the order written, each with its gate flag. */
  evaluators?: EvaluatorFlagRef[];
  /** `--evaluators-json <file|json>`: the full attachment list. */
  evaluatorsJson?: string;
}

/**
 * Edits a test suite: any of its name, its fields and its evaluators.
 *
 * A field list or an evaluator list given here replaces the one the suite
 * holds, so the command line says the whole of what the suite declares. A
 * flag left out keeps what the suite has. The mappings of an `--evaluator`
 * are inferred against the field list the suite ends up with.
 *
 * @see specs/features/test-suite-cli.feature
 */
export const updateTestSuiteCommand = async (
  reference: string,
  options: UpdateTestSuiteOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliTestSuitesService();
  let suite: Awaited<ReturnType<typeof resolveSuiteReference>>;
  try {
    suite = await resolveSuiteReference({ reference, service });
  } catch (error) {
    if (error instanceof SuiteReferenceError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  const fields = parseSuiteFieldDefinitionFlags({ pairs: options.field });
  const evaluators = await readEvaluators({
    options,
    fields: fields ?? suite.fields ?? [],
  });

  const body: UpdateTestSuiteBody = {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(evaluators !== undefined ? { evaluators } : {}),
  };
  if (Object.keys(body).length === 0) {
    reportCommandError({
      error: commandValidationError(
        "Nothing to update: give --name, --field, --evaluator or --evaluators-json",
      ),
    });
    process.exit(1);
  }

  const spinner = createSpinner(`Updating test suite "${suite.name}"...`).start();

  try {
    const updated = await service.update(suite.id, body);

    spinner.succeed(`Test suite "${updated.name}" updated`);

    return {
      data: updated,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}   ${chalk.green(updated.id)}`);
        console.log(`  ${chalk.gray("Name:")} ${chalk.cyan(updated.name)}`);
        console.log(`  ${chalk.gray("Slug:")} ${chalk.yellow(updated.slug)}`);
        printSuiteFields(updated.fields);
        printEvaluators(updated.evaluators);
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update test suite" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliScenariosService } from "./cli-scenarios-service";
import {
  resolveSuiteReference,
  SuiteReferenceError,
} from "../test-suites/resolveSuite";

export const createScenarioCommand = async (
  name: string,
  options: {
    situation: string;
    criteria?: string;
    labels?: string;
    testSuite?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // The test suite is resolved before anything is created, so a reference that
  // names nothing leaves no half-filed scenario behind.
  let testSuiteId: string | undefined;
  let testSuiteName: string | undefined;
  if (options.testSuite !== undefined) {
    try {
      const testSuite = await resolveSuiteReference({
        reference: options.testSuite,
      });
      testSuiteId = testSuite.id;
      testSuiteName = testSuite.name;
    } catch (error) {
      if (error instanceof SuiteReferenceError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }
  }

  const service = createCliScenariosService();
  const spinner = createSpinner(`Creating scenario "${name}"...`).start();

  try {
    const criteria = options.criteria
      ? options.criteria.split(",").map((c) => c.trim())
      : [];
    const labels = options.labels ? options.labels.split(",").map((l) => l.trim()) : [];

    const scenario = await service.create({
      name,
      situation: options.situation,
      criteria,
      labels,
      ...(testSuiteId !== undefined && { testSuiteId }),
    });

    spinner.succeed(
      testSuiteName
        ? `Created scenario "${chalk.cyan(scenario.name)}" in test suite "${chalk.cyan(testSuiteName)}" ${chalk.gray(`(id: ${scenario.id})`)}`
        : `Created scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    return {
      data: scenario,
      table: () => {
        if (scenario.platformUrl) {
          console.log(
            `  ${chalk.bold("View:")}  ${chalk.underline(scenario.platformUrl)}`,
          );
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create scenario" });
    process.exit(1);
  }
};

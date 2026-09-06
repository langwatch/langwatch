import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import type { UpdateScenarioBody } from "@/client-sdk/services/scenarios";
import type { SuiteFieldDefinition } from "@/client-sdk/services/test-suites";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { parseScenarioFieldFlags } from "../../utils/suiteFieldFlags";
import { createCliScenariosService } from "./cli-scenarios-service";
import { createCliTestSuitesService } from "../test-suites/cli-test-suites-service";
import {
  resolveSuiteReference,
  SuiteReferenceError,
} from "../test-suites/resolveSuite";

/**
 * The field definitions of the suite a scenario is filed in, or none when
 * the scenario or its suite cannot be read: the values are then sent as they
 * look, and the platform settles them by name.
 */
async function suiteFieldsOfScenario({
  id,
  service,
}: {
  id: string;
  service: ReturnType<typeof createCliScenariosService>;
}): Promise<SuiteFieldDefinition[] | undefined> {
  try {
    const scenario = await service.get(id);
    if (!scenario.testSuiteId) return undefined;
    const suite = await createCliTestSuitesService().get(scenario.testSuiteId);
    return suite.fields ?? [];
  } catch {
    return undefined;
  }
}

export const updateScenarioCommand = async (
  id: string,
  options: {
    name?: string;
    situation?: string;
    criteria?: string;
    labels?: string;
    testSuite?: string;
    noTestSuite?: boolean;
    /** `--field identifier=value`, one per occurrence. Given, it replaces the values. */
    field?: string[];
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // One of the two says where the scenario goes, so a line carrying both says
  // two different things. It is refused before the scenario is touched.
  if (options.testSuite !== undefined && options.noTestSuite) {
    console.error(
      chalk.red(
        "Error: --test-suite and --no-test-suite cannot be used together.",
      ),
    );
    process.exit(1);
  }

  let testSuiteId: string | null | undefined;
  let testSuiteName: string | undefined;
  let fieldDefinitions: SuiteFieldDefinition[] | undefined;
  if (options.testSuite !== undefined) {
    try {
      const testSuite = await resolveSuiteReference({
        reference: options.testSuite,
      });
      testSuiteId = testSuite.id;
      testSuiteName = testSuite.name;
      fieldDefinitions = testSuite.fields ?? [];
    } catch (error) {
      if (error instanceof SuiteReferenceError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }
  } else if (options.noTestSuite) {
    testSuiteId = null;
  }

  const service = createCliScenariosService();

  // A field value is read by the type the suite declares, so the suite the
  // scenario stays in is looked up when the command line names none.
  if (options.field !== undefined && fieldDefinitions === undefined) {
    fieldDefinitions = await suiteFieldsOfScenario({ id, service });
  }
  const fields = parseScenarioFieldFlags({
    pairs: options.field,
    definitions: fieldDefinitions,
  });

  const spinner = createSpinner(`Updating scenario "${id}"...`).start();

  try {
    const body: UpdateScenarioBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.situation !== undefined) body.situation = options.situation;
    if (options.criteria !== undefined)
      body.criteria = options.criteria.split(",").map((c) => c.trim());
    if (options.labels !== undefined)
      body.labels = options.labels.split(",").map((l) => l.trim());
    if (testSuiteId !== undefined) body.testSuiteId = testSuiteId;
    if (fields !== undefined) body.fields = fields;

    const scenario = await service.update(id, body);

    const movement =
      testSuiteId === null
        ? " (no test suite)"
        : testSuiteName
          ? ` (test suite: ${testSuiteName})`
          : "";
    spinner.succeed(
      `Updated scenario "${chalk.cyan(scenario.name)}"${movement} ${chalk.gray(`(id: ${scenario.id})`)}`,
    );

    return {
      data: scenario,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update scenario" });
    process.exit(1);
  }
};

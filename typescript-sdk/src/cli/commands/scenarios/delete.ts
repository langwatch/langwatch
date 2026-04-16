import chalk from "chalk";
import ora from "ora";
import {
  ScenariosApiService,
  ScenariosApiError,
} from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const deleteScenarioCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new ScenariosApiService();

  const resolveSpinner = ora(`Finding scenario "${id}"...`).start();

  let scenarioName: string;
  try {
    const scenario = await service.get(id);
    scenarioName = scenario.name;
    resolveSpinner.succeed(`Found scenario "${scenarioName}"`);
  } catch (error) {
    resolveSpinner.fail();
    if (error instanceof ScenariosApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error finding scenario: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }

  const deleteSpinner = ora(`Archiving scenario "${scenarioName}"...`).start();

  try {
    await service.delete(id);
    deleteSpinner.succeed(
      `Archived scenario "${chalk.cyan(scenarioName)}"`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify({ id, name: scenarioName, archived: true }, null, 2));
    }
  } catch (error) {
    deleteSpinner.fail();
    if (error instanceof ScenariosApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error archiving scenario: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};

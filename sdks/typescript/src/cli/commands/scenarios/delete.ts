import chalk from "chalk";
import ora from "ora";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({
      spinner: resolveSpinner,
      error,
      action: `find scenario "${id}"`,
    });
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
    failSpinner({
      spinner: deleteSpinner,
      error,
      action: `archive scenario "${scenarioName}"`,
    });
    process.exit(1);
  }
};

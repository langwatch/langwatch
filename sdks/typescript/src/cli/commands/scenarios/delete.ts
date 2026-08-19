import chalk from "chalk";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export const deleteScenarioCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ScenariosApiService();

  const resolveSpinner = createSpinner(`Finding scenario "${id}"...`).start();

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

  const deleteSpinner = createSpinner(
    `Archiving scenario "${scenarioName}"...`,
  ).start();

  try {
    await service.delete(id);
    deleteSpinner.succeed(`Archived scenario "${chalk.cyan(scenarioName)}"`);
  } catch (error) {
    failSpinner({
      spinner: deleteSpinner,
      error,
      action: `archive scenario "${scenarioName}"`,
    });
    process.exit(1);
  }

  return {
    data: { id, name: scenarioName, archived: true },
    table: () => {
      // The spinner's success line is the human output.
    },
  };
};

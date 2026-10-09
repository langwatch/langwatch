import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { resolveScenarioOrExit } from "./resolveScenario";

/** Archives one scenario, named by its id or by its name. */
export const deleteScenarioCommand = async (reference: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ScenariosApiService();

  const resolveSpinner = createSpinner(`Finding scenario "${reference}"...`).start();

  let id: string;
  let scenarioName: string;
  try {
    const scenario = await resolveScenarioOrExit({ reference, service });
    id = scenario.id;
    scenarioName = scenario.name;
    resolveSpinner.succeed(`Found scenario "${scenarioName}"`);
  } catch (error) {
    failSpinner({
      spinner: resolveSpinner,
      error,
      action: `find scenario "${reference}"`,
    });
    process.exit(1);
  }

  const deleteSpinner = createSpinner(`Archiving scenario "${scenarioName}"...`).start();

  try {
    await service.delete(id);
    deleteSpinner.succeed(
      `Archived scenario "${chalk.cyan(scenarioName)}"`,
    );
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

import chalk from "chalk";
import ora from "ora";
import {
  ScenariosApiService,
  ScenariosApiError,
} from "@/client-sdk/services/scenarios";
import type { UpdateScenarioBody } from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";

export const updateScenarioCommand = async (
  id: string,
  options: { name?: string; situation?: string; criteria?: string; labels?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = ora(`Updating scenario "${id}"...`).start();

  try {
    const body: UpdateScenarioBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.situation !== undefined) body.situation = options.situation;
    if (options.criteria !== undefined)
      body.criteria = options.criteria.split(",").map((c) => c.trim());
    if (options.labels !== undefined)
      body.labels = options.labels.split(",").map((l) => l.trim());

    const scenario = await service.update(id, body);

    spinner.succeed(
      `Updated scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof ScenariosApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error updating scenario: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

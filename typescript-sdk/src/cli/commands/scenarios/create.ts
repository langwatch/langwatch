import chalk from "chalk";
import ora from "ora";
import {
  ScenariosApiService,
  ScenariosApiError,
} from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";

export const createScenarioCommand = async (
  name: string,
  options: { situation: string; criteria?: string; labels?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = ora(`Creating scenario "${name}"...`).start();

  try {
    const criteria = options.criteria
      ? options.criteria.split(",").map((c) => c.trim())
      : [];
    const labels = options.labels
      ? options.labels.split(",").map((l) => l.trim())
      : [];

    const scenario = await service.create({
      name,
      situation: options.situation,
      criteria,
      labels,
    });

    spinner.succeed(
      `Created scenario "${chalk.cyan(scenario.name)}" ${chalk.gray(`(id: ${scenario.id})`)}`,
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof ScenariosApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error creating scenario: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

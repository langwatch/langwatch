import chalk from "chalk";
import ora from "ora";
import {
  ScenariosApiService,
  ScenariosApiError,
} from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const createScenarioCommand = async (
  name: string,
  options: { situation: string; criteria?: string; labels?: string; format?: string },
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

    if (options.format === "json") {
      console.log(JSON.stringify(scenario, null, 2));
    } else if (scenario.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(scenario.platformUrl)}`);
    }
  } catch (error) {
    spinner.fail();
    if (error instanceof ScenariosApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error creating scenario: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};

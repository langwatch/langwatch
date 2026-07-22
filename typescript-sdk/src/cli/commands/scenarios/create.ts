import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const createScenarioCommand = async (
  name: string,
  options: { situation: string; criteria?: string; labels?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = createSpinner(`Creating scenario "${name}"...`).start();

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

    return {
      data: scenario,
      table: () => {
        if (scenario.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(scenario.platformUrl)}`);
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create scenario" });
    process.exit(1);
  }
};

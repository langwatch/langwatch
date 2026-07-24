import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import type { ScenarioResponse } from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

const formatScenarioDetails = (scenario: ScenarioResponse): void => {
  console.log();
  console.log(chalk.bold.cyan(scenario.name));
  console.log(chalk.gray("─".repeat(40)));

  console.log(`  ${chalk.gray("ID:")}        ${scenario.id}`);

  if (scenario.labels.length > 0) {
    console.log(
      `  ${chalk.gray("Labels:")}    ${scenario.labels.map((l) => chalk.yellow(l)).join(", ")}`,
    );
  }

  console.log();
  console.log(chalk.bold("  Situation:"));
  console.log(`    ${scenario.situation}`);

  if (scenario.criteria.length > 0) {
    console.log();
    console.log(chalk.bold("  Criteria:"));
    scenario.criteria.forEach((criterion) => {
      console.log(`    ${chalk.green("•")} ${criterion}`);
    });
  }

  if (scenario.platformUrl) {
    console.log(`  ${chalk.bold("View:")}  ${chalk.underline(scenario.platformUrl)}`);
  }

  console.log();
};

export const getScenarioCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = createSpinner(`Fetching scenario "${id}"...`).start();

  try {
    const scenario = await service.get(id);
    spinner.succeed(`Found scenario "${scenario.name}"`);
    return {
      data: scenario,
      table: () => {
        formatScenarioDetails(scenario);
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch scenario" });
    process.exit(1);
  }
};

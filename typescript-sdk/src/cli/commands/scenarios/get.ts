import chalk from "chalk";
import ora from "ora";
import {
  ScenariosApiService,
  ScenariosApiError,
} from "@/client-sdk/services/scenarios";
import type { ScenarioResponse } from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";

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

  if ((scenario as Record<string, unknown>).platformUrl) {
    console.log(`  ${chalk.bold("View:")}  ${chalk.underline((scenario as Record<string, unknown>).platformUrl as string)}`);
  }

  console.log();
};

export const getScenarioCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = ora(`Fetching scenario "${id}"...`).start();

  try {
    const scenario = await service.get(id);
    spinner.succeed(`Found scenario "${scenario.name}"`);
    if (options?.format === "json") {
      console.log(JSON.stringify(scenario, null, 2));
      return;
    }
    formatScenarioDetails(scenario);
  } catch (error) {
    spinner.fail();
    if (error instanceof ScenariosApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching scenario: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

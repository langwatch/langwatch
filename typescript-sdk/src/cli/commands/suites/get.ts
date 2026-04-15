import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  SuitesApiError,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";

export const getSuiteCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = ora(`Fetching suite "${id}"...`).start();

  try {
    const suite = await service.get(id);

    spinner.succeed(`Found suite "${suite.name}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(suite, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold("  Suite Details:"));
    console.log(`    ${chalk.gray("ID:")}          ${chalk.green(suite.id)}`);
    console.log(`    ${chalk.gray("Name:")}        ${chalk.cyan(suite.name)}`);
    console.log(`    ${chalk.gray("Slug:")}        ${chalk.yellow(suite.slug)}`);
    console.log(`    ${chalk.gray("Description:")} ${suite.description ?? chalk.gray("—")}`);
    console.log(`    ${chalk.gray("Repeat:")}      ${suite.repeatCount}`);
    console.log(`    ${chalk.gray("Labels:")}      ${suite.labels.length > 0 ? suite.labels.join(", ") : chalk.gray("—")}`);
    console.log(`    ${chalk.gray("Created:")}     ${new Date(suite.createdAt).toLocaleString()}`);
    console.log(`    ${chalk.gray("Updated:")}     ${new Date(suite.updatedAt).toLocaleString()}`);

    console.log();
    console.log(chalk.bold("  Scenarios:"));
    for (const scenarioId of suite.scenarioIds) {
      console.log(`    ${chalk.gray("•")} ${scenarioId}`);
    }

    console.log();
    console.log(chalk.bold("  Targets:"));
    for (const target of suite.targets) {
      console.log(`    ${chalk.gray("•")} ${target.type}:${target.referenceId}`);
    }

    console.log();
    console.log(
      chalk.gray(
        `Run this suite with: ${chalk.cyan(`langwatch suite run ${suite.id}`)}`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof SuitesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

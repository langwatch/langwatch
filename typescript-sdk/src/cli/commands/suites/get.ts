import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the suite rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getSuiteCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = createSpinner(`Fetching suite "${id}"...`).start();

  try {
    const suite = await service.get(id);

    spinner.succeed(`Found suite "${suite.name}"`);

    return {
      data: suite,
      table: () => {
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

        if (suite.platformUrl) {
          console.log();
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(suite.platformUrl)}`);
        }

        console.log();
        console.log(
          chalk.gray(
            `Run this suite with: ${chalk.cyan(`langwatch suite run ${suite.id}`)}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch suite" });
    process.exit(1);
  }
};

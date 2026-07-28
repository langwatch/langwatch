import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the duplicated suite rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const duplicateSuiteCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = createSpinner(`Duplicating suite "${id}"...`).start();

  try {
    const suite = await service.duplicate(id);

    spinner.succeed(`Suite duplicated as "${suite.name}" (${suite.id})`);

    return {
      data: suite,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("New ID:")}   ${chalk.green(suite.id)}`);
        console.log(`  ${chalk.gray("Name:")}     ${chalk.cyan(suite.name)}`);
        console.log(`  ${chalk.gray("Slug:")}     ${chalk.yellow(suite.slug)}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "duplicate suite" });
    process.exit(1);
  }
};

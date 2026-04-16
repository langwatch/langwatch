import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  SuitesApiError,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const duplicateSuiteCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = ora(`Duplicating suite "${id}"...`).start();

  try {
    const suite = await service.duplicate(id);

    spinner.succeed(`Suite duplicated as "${suite.name}" (${suite.id})`);

    if (options?.format === "json") {
      console.log(JSON.stringify(suite, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("New ID:")}   ${chalk.green(suite.id)}`);
    console.log(`  ${chalk.gray("Name:")}     ${chalk.cyan(suite.name)}`);
    console.log(`  ${chalk.gray("Slug:")}     ${chalk.yellow(suite.slug)}`);
    console.log();
  } catch (error) {
    spinner.fail();
    if (error instanceof SuitesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};

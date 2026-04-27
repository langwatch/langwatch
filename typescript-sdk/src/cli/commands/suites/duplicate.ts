import chalk from "chalk";
import ora from "ora";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "duplicate suite" });
    process.exit(1);
  }
};

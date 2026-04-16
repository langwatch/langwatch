import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  SuitesApiError,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const deleteSuiteCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = ora(`Archiving suite "${id}"...`).start();

  try {
    const result = await service.delete(id);

    spinner.succeed(`Suite "${id}" archived`);

    if (options?.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    }
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

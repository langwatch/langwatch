import chalk from "chalk";
import ora from "ora";
import {
  ScenariosApiService,
  ScenariosApiError,
} from "@/client-sdk/services/scenarios";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const listScenariosCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new ScenariosApiService();
  const spinner = ora("Fetching scenarios...").start();

  try {
    const scenarios = await service.getAll();

    spinner.succeed(
      `Found ${scenarios.length} scenario${scenarios.length !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(scenarios, null, 2));
      return;
    }

    if (scenarios.length === 0) {
      console.log();
      console.log(chalk.gray("No scenarios found in this project."));
      console.log(chalk.gray("Create your first scenario with:"));
      console.log(
        chalk.cyan(
          '  langwatch scenario create "Login Flow" --situation "User attempts to log in"',
        ),
      );
      return;
    }

    console.log();

    const tableData = scenarios.map((scenario) => ({
      Name: scenario.name,
      ID: scenario.id,
      Labels: scenario.labels.length > 0 ? scenario.labels.join(", ") : chalk.gray("—"),
      Criteria: `${scenario.criteria.length}`,
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Labels", "Criteria"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
        Labels: chalk.yellow,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch scenario get <id>")} to view scenario details`,
      ),
    );
  } catch (error) {
    // ScenariosApiError.message already starts with "Failed to …" via
    // formatApiErrorForOperation, so don't double-prefix.
    const message =
      error instanceof ScenariosApiError
        ? error.message
        : `Failed to fetch scenarios: ${formatApiErrorMessage({ error })}`;
    spinner.fail(chalk.red(message));
    process.exit(1);
  }
};

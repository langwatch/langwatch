import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ScenariosApiService } from "@/client-sdk/services/scenarios";
import { createCliTestSuitesService } from "../test-suites/cli-test-suites-service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/** What the Folder column shows for a scenario filed nowhere. */
const UNFILED = "unfiled";

export const listScenariosCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ScenariosApiService();
  const spinner = createSpinner("Fetching scenarios...").start();

  try {
    const scenarios = await service.getAll();

    // The scenario carries a test suite id; the suite carries the name a
    // person reads. A project that files nothing keeps the request it always
    // made.
    const folderNameById = new Map<string, string>();
    if (scenarios.some((scenario) => scenario.folderId)) {
      const suites = await createCliTestSuitesService().list();
      for (const suite of suites) folderNameById.set(suite.id, suite.name);
    }

    spinner.succeed(
      `Found ${scenarios.length} scenario${scenarios.length !== 1 ? "s" : ""}`,
    );

    return {
      data: scenarios,
      table: () => {
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
          Folder: scenario.folderId
            ? (folderNameById.get(scenario.folderId) ?? scenario.folderId)
            : chalk.gray(UNFILED),
          Labels: scenario.labels.length > 0 ? scenario.labels.join(", ") : chalk.gray("—"),
          Criteria: `${scenario.criteria.length}`,
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Folder", "Labels", "Criteria"],
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
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch scenarios" });
    process.exit(1);
  }
};

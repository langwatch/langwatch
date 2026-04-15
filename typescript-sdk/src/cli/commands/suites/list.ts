import chalk from "chalk";
import ora from "ora";
import {
  SuitesApiService,
  SuitesApiError,
} from "@/client-sdk/services/suites";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";

export const listSuitesCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new SuitesApiService();
  const spinner = ora("Fetching suites...").start();

  try {
    const suites = await service.getAll();

    spinner.succeed(
      `Found ${suites.length} suite${suites.length !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(suites, null, 2));
      return;
    }

    if (suites.length === 0) {
      console.log();
      console.log(chalk.gray("No suites (run plans) found in this project."));
      console.log(chalk.gray("Create your first suite with:"));
      console.log(
        chalk.cyan(
          '  langwatch suite create "My Suite" --scenarios <id1>,<id2> --targets http:<agentId>',
        ),
      );
      return;
    }

    console.log();

    const tableData = suites.map((suite) => ({
      Name: suite.name,
      ID: suite.id,
      Slug: suite.slug,
      Scenarios: `${suite.scenarioIds.length}`,
      Targets: `${suite.targets.length}`,
      Repeat: `${suite.repeatCount}`,
    }));

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Slug", "Scenarios", "Targets", "Repeat"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
        Slug: chalk.yellow,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch suite get <id>")} to view details or ${chalk.cyan("langwatch suite run <id>")} to execute`,
      ),
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof SuitesApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching suites: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};

import chalk from "chalk";
import { SuitesApiService } from "@/client-sdk/services/suites";
import { createSpinner } from "../../../utils/spinner";
import { resolveCredentials } from "../../../utils/apiKey";
import { failSpinner } from "../../../utils/spinnerError";
import type { CommandResult } from "../../../utils/output";

/**
 * Creates an empty test suite folder. Test cases join it afterwards, with
 * `langwatch scenario update <id> --folder <folder>`.
 *
 * A folder and a run plan share one name space for slugs, so a name another
 * suite already uses gets a distinct slug rather than a refusal.
 */
export const createFolderCommand = async (
  name: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new SuitesApiService();
  const spinner = createSpinner(`Creating test suite folder "${name}"...`).start();

  try {
    const folder = await service.create({ name, kind: "folder" });

    spinner.succeed(
      `Created test suite folder "${chalk.cyan(folder.name)}" ${chalk.gray(`(id: ${folder.id})`)}`,
    );

    return {
      data: folder,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}         ${chalk.green(folder.id)}`);
        console.log(`  ${chalk.gray("Slug:")}       ${chalk.yellow(folder.slug)}`);
        console.log(`  ${chalk.gray("Test cases:")} ${folder.scenarioIds.length}`);
        console.log();
        console.log(
          chalk.gray(
            `File a test case into it with ${chalk.cyan(`langwatch scenario update <id> --folder ${folder.id}`)}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create test suite folder" });
    process.exit(1);
  }
};

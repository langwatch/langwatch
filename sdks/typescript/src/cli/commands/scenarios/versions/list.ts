import chalk from "chalk";
import { createSpinner } from "../../../utils/spinner";
import { resolveCredentials } from "../../../utils/apiKey";
import { formatTable } from "../../../utils/formatting";
import { failSpinner } from "../../../utils/spinnerError";
import type { CommandResult } from "../../../utils/output";
import { createCliScenariosService } from "../cli-scenarios-service";

/**
 * The saved versions of a scenario, newest first.
 *
 * A scenario saved before versions were recorded closes its history with a
 * Created entry that has no snapshot to read back.
 *
 * @see specs/scenarios/scenario-versioning.feature
 */
export const listScenarioVersionsCommand = async (
  scenarioId: string,
  options?: { limit?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliScenariosService();
  const spinner = createSpinner(
    `Fetching versions of scenario "${scenarioId}"...`,
  ).start();

  try {
    const limit = options?.limit ? parseInt(options.limit, 10) : undefined;
    const page = await service.listVersions(scenarioId, {
      ...(limit !== undefined && !Number.isNaN(limit) && { limit }),
    });

    spinner.succeed(
      `Found ${page.versions.length} version${page.versions.length !== 1 ? "s" : ""}`,
    );

    return {
      data: page,
      table: () => {
        if (page.versions.length === 0) {
          console.log();
          console.log(chalk.gray("No versions recorded for this scenario."));
          return;
        }

        console.log();

        const tableData = page.versions.map((version) => ({
          Version: `v${version.version}`,
          Author: version.authorLabel ?? chalk.gray("—"),
          Date: new Date(version.createdAt).toISOString(),
          Changed:
            version.changedFields.length > 0
              ? version.changedFields.join(", ")
              : (version.changeDescription ?? chalk.gray("—")),
        }));

        formatTable({
          data: tableData,
          headers: ["Version", "Author", "Date", "Changed"],
          colorMap: {
            Version: chalk.green,
            Author: chalk.yellow,
          },
        });

        console.log();
        if (page.nextCursor !== null) {
          console.log(
            chalk.gray(
              `More versions below v${page.nextCursor}. Use ${chalk.cyan("--limit")} to read more.`,
            ),
          );
        }
        console.log(
          chalk.gray(
            `Use ${chalk.cyan(`langwatch scenario version get ${scenarioId} <version>`)} to read one`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch scenario versions" });
    process.exit(1);
  }
};

import chalk from "chalk";
import { createSpinner } from "../../../utils/spinner";
import { resolveCredentials } from "../../../utils/apiKey";
import { failSpinner } from "../../../utils/spinnerError";
import type { CommandResult } from "../../../utils/output";
import { createCliScenariosService } from "../cli-scenarios-service";

/**
 * One saved version of a scenario, with the content it saved.
 *
 * @see specs/scenarios/scenario-versioning.feature
 */
export const getScenarioVersionCommand = async (
  scenarioId: string,
  version: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  // Number(), not parseInt(): parseInt("2.7") is 2 and parseInt("2abc") is 2,
  // so the command would silently read a version nobody asked for. The REST
  // layer answers 422 for the same input, and the CLI refuses it the same way.
  const versionNumber = Number(version.trim());
  if (
    version.trim() === "" ||
    !Number.isInteger(versionNumber) ||
    versionNumber < 1
  ) {
    console.error(
      chalk.red(`Error: "${version}" is not a version number. Use a whole number, e.g. 2.`),
    );
    process.exit(1);
  }

  const service = createCliScenariosService();
  const spinner = createSpinner(
    `Fetching version ${versionNumber} of scenario "${scenarioId}"...`,
  ).start();

  try {
    const detail = await service.getVersion(scenarioId, versionNumber);

    spinner.succeed(`Found version ${versionNumber}`);

    return {
      data: detail,
      table: () => {
        console.log();
        console.log(chalk.bold.cyan(detail.snapshot.name));
        console.log(chalk.gray("─".repeat(40)));
        console.log(`  ${chalk.gray("Version:")}   ${chalk.green(`v${detail.version}`)}`);
        console.log(
          `  ${chalk.gray("Author:")}    ${detail.authorLabel ?? chalk.gray("—")}`,
        );
        console.log(
          `  ${chalk.gray("Saved:")}     ${new Date(detail.createdAt).toISOString()}`,
        );
        if (detail.changedFields.length > 0) {
          console.log(
            `  ${chalk.gray("Changed:")}   ${detail.changedFields.join(", ")}`,
          );
        }
        if (detail.snapshot.labels.length > 0) {
          console.log(
            `  ${chalk.gray("Labels:")}    ${detail.snapshot.labels.map((l) => chalk.yellow(l)).join(", ")}`,
          );
        }

        console.log();
        console.log(chalk.bold("  Situation:"));
        console.log(`    ${detail.snapshot.situation}`);

        if (detail.snapshot.criteria.length > 0) {
          console.log();
          console.log(chalk.bold("  Criteria:"));
          detail.snapshot.criteria.forEach((criterion) => {
            console.log(`    ${chalk.green("•")} ${criterion}`);
          });
        }

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch scenario version" });
    process.exit(1);
  }
};

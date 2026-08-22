import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { parsePositiveIntOrNull } from "../../utils/positiveInt";
import type { CommandResult } from "../../utils/output";

export const experimentRestoreCommand = async (
  slug: string,
  version: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(
    `Restoring "${slug}" to version ${version}...`,
  ).start();

  try {
    const parsedVersion = parsePositiveIntOrNull(version);
    if (parsedVersion === null) {
      throw new Error(
        `The version to restore is a version number, like 3. Got "${version}".`,
      );
    }

    const service = new ExperimentsApiService();
    const restored = await service.restoreVersion({
      slug,
      version: parsedVersion,
    });

    spinner.succeed(
      `"${slug}" restored from v${parsedVersion}, now at version ${chalk.cyan(restored.version)}`,
    );

    return {
      data: { slug, restoredFrom: parsedVersion, ...restored },
      table: () => {
        console.log();
        console.log(
          chalk.gray(
            "The version you restored from is still in the history, and the restore is one more entry after it.",
          ),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "restore experiment version" });
    process.exit(1);
  }
};

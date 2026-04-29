import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the restored version rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const promptRestoreCommand = async (
  handle: string,
  versionId: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner(
    `Restoring "${handle}" to version ${versionId}...`
  ).start();

  try {
    const restored = (await apiRequest({
      method: "POST",
      path: `/api/prompts/${encodeURIComponent(handle)}/versions/${encodeURIComponent(versionId)}/restore`,
      apiKey,
      endpoint,
    })) as { id: string; version: number; commitMessage: string | null };

    spinner.succeed(
      `Restored "${handle}" — new version v${restored.version} created`
    );

    return {
      data: restored,
      table: () => {
        console.log();
        console.log(
          `  ${chalk.gray("New version:")} ${chalk.cyan(`v${restored.version}`)}`
        );
        console.log(
          `  ${chalk.gray("Message:")}     ${restored.commitMessage ?? chalk.gray("—")}`
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: `restore "${handle}" to ${versionId}` });
    process.exit(1);
  }
};

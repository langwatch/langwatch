import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

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
    const response = await fetch(
      `${endpoint}/api/prompts/${encodeURIComponent(handle)}/versions/${encodeURIComponent(versionId)}/restore`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey }),
        },
      }
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({
        spinner,
        error: new Error(message),
        action: `restore "${handle}" to ${versionId}`,
      });
      process.exit(1);
    }

    const restored = (await response.json()) as {
      id: string;
      version: number;
      commitMessage: string | null;
    };

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
    failSpinner({ spinner, error, action: "restore prompt" });
    process.exit(1);
  }
};

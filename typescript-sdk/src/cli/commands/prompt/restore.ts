import chalk from "chalk";
import ora from "ora";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const promptRestoreCommand = async (
  handle: string,
  versionId: string,
  options?: { format?: string }
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(
    `Restoring "${handle}" to version ${versionId}...`
  ).start();

  try {
    let restored: { id: string; version: number; commitMessage: string | null };
    try {
      restored = (await apiRequest({
        method: "POST",
        path: `/api/prompts/${encodeURIComponent(handle)}/versions/${encodeURIComponent(versionId)}/restore`,
        apiKey,
        endpoint,
      })) as { id: string; version: number; commitMessage: string | null };
    } catch (httpError) {
      const message = httpError instanceof Error ? httpError.message : String(httpError);
      spinner.fail(`Failed to restore "${handle}" to ${versionId}: ${message}`);
      process.exit(1);
    }

    spinner.succeed(
      `Restored "${handle}" — new version v${restored.version} created`
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(restored, null, 2));
      return;
    }

    console.log();
    console.log(
      `  ${chalk.gray("New version:")} ${chalk.cyan(`v${restored.version}`)}`
    );
    console.log(
      `  ${chalk.gray("Message:")}     ${restored.commitMessage ?? chalk.gray("—")}`
    );
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "restore prompt" });
    process.exit(1);
  }
};

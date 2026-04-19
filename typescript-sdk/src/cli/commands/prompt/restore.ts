import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
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
    const response = await fetch(
      `${endpoint}/api/prompts/${encodeURIComponent(handle)}/versions/${encodeURIComponent(versionId)}/restore`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": apiKey,
        },
      }
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to restore "${handle}" to ${versionId}: ${message}`);
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

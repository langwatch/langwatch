import chalk from "chalk";

import { PromptsApiService } from "@/client-sdk/services/prompts";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Fetch one prompt; agents improving prompts reach for get first.
 */
export const promptGetCommand = async (
  handle: string,
  options?: { version?: string; tag?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new PromptsApiService();

  const spinner = createSpinner(`Fetching prompt "${handle}"...`).start();

  try {
    const prompt = await service.get(handle, {
      ...(options?.version ? { version: options.version } : {}),
      ...(options?.tag ? { tag: options.tag } : {}),
    });

    spinner.succeed(`Fetched "${handle}"`);

    return {
      data: prompt,
      table: () => {
        console.log();
        console.log(`${chalk.gray("Handle")}   ${prompt.handle ?? prompt.id}`);
        console.log(`${chalk.gray("ID")}       ${prompt.id}`);
        console.log(`${chalk.gray("Version")}  v${prompt.version}`);
        console.log(`${chalk.gray("Model")}    ${prompt.model}`);
        console.log();

        for (const message of prompt.messages ?? []) {
          console.log(chalk.cyan(message.role));
          console.log(message.content);
          console.log();
        }

        console.log(
          chalk.gray(`  Tip: See every version with: langwatch prompt versions ${handle}`),
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch prompt" });
    process.exit(1);
  }
};

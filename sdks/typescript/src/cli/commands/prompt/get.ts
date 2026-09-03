import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { resolveCredentials } from "../../utils/apiKey";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Reads one prompt, the way every other resource reads one of its own.
 *
 * `versions` lists the rows around a prompt and `list` lists the prompts, so
 * without this the only way to read the prompt itself was to list everything
 * and filter. An agent asked to improve a prompt reaches for `get` first.
 *
 * Returns the prompt rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
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

import chalk from "chalk";
import * as readline from "readline";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";

const promptConfirmation = (tagName: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(
        `This will remove all assignments for "${tagName}". Type "${tagName}" to confirm: `,
      ),
      (answer) => {
        rl.close();
        resolve(answer.trim());
      },
    );
  });
};

/**
 * Deletes a tag and removes all its assignments.
 * @param tagName The tag name to delete.
 * @param options Optional parameters.
 * @param options.force Skip confirmation prompt.
 */
export const tagDeleteCommand = async (
  tagName: string,
  options?: { force?: boolean },
): Promise<CommandResult | void> => {
  checkApiKey();

  if (!options?.force) {
    const confirmation = await promptConfirmation(tagName);
    if (confirmation !== tagName) {
      console.log(chalk.gray("Aborted."));
      return;
    }
  }

  const service = new PromptsApiService();
  await service.deleteTag(tagName);
  return {
    data: { name: tagName, deleted: true },
    table: () => {
      console.log(chalk.green(`✓ Deleted tag: ${tagName}`));
    },
  };
};

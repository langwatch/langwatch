import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../../utils/apiKey";
import { validateTagName } from "./validation";
import type { CommandResult } from "../../utils/output";

/**
 * Renames an existing tag.
 * @param oldName The current tag name.
 * @param newName The new tag name.
 */
export const tagRenameCommand = async (oldName: string, newName: string): Promise<CommandResult | void> => {
  const validationError = validateTagName(newName);
  if (validationError) {
    console.error(chalk.red(`Error: ${validationError}`));
    process.exit(1);
  }

  checkApiKey();
  const service = new PromptsApiService();
  await service.renameTag({ tag: oldName, name: newName });
  return {
    data: { oldName, newName, renamed: true },
    table: () => {
      console.log(chalk.green(`✓ Renamed tag: ${oldName} -> ${newName}`));
    },
  };
};

import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { resolveCredentials } from "../../utils/apiKey";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { validateTagName } from "./validation";

/**
 * Renames an existing tag.
 * @param oldName The current tag name.
 * @param newName The new tag name.
 */
export const tagRenameCommand = async (
  oldName: string,
  newName: string,
): Promise<CommandResult | void> => {
  const validationError = validateTagName(newName);
  if (validationError) {
    reportCommandError({ error: commandValidationError(validationError) });
    process.exit(1);
  }

  await resolveCredentials();
  const service = new PromptsApiService();
  await service.renameTag({ tag: oldName, name: newName });
  return {
    data: { oldName, newName, renamed: true },
    table: () => {
      console.log(chalk.green(`✓ Renamed tag: ${oldName} -> ${newName}`));
    },
  };
};

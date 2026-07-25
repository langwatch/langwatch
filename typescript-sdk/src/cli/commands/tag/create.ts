import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../../utils/apiKey";
import { validateTagName } from "./validation";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Creates a custom tag for the organization.
 * @param name The tag name to create.
 */
export const tagCreateCommand = async (name: string): Promise<CommandResult | void> => {
  const validationError = validateTagName(name);
  if (validationError) {
    reportCommandError({ error: commandValidationError(validationError) });
    process.exit(1);
  }

  checkApiKey();
  const service = new PromptsApiService();
  await service.createTag({ name });
  return {
    data: { name, created: true },
    table: () => {
      console.log(chalk.green(`✓ Created tag: ${name}`));
    },
  };
};

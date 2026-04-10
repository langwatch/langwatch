import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../../utils/apiKey";
import { validateTagName } from "./validation";

/**
 * Creates a custom tag for the organization.
 * @param name The tag name to create.
 */
export const tagCreateCommand = async (name: string): Promise<void> => {
  const validationError = validateTagName(name);
  if (validationError) {
    console.error(chalk.red(`Error: ${validationError}`));
    process.exit(1);
  }

  checkApiKey();
  const service = new PromptsApiService();
  await service.createTag({ name });
  console.log(chalk.green(`✓ Created tag: ${name}`));
};

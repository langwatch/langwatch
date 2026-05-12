import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { checkApiKey } from "../../utils/apiKey";

/**
 * Assigns a tag to a prompt version.
 * @param promptHandle The prompt handle/id.
 * @param tagName The tag name to assign.
 * @param options Optional parameters.
 * @param options.version Specific version number to tag (defaults to latest).
 */
export const tagAssignCommand = async (
  promptHandle: string,
  tagName: string,
  options?: { version?: string },
): Promise<void> => {
  if (options?.version !== undefined && !/^[1-9]\d*$/.test(options.version)) {
    console.error(
      chalk.red("Error: --version must be a positive integer"),
    );
    process.exit(1);
  }

  checkApiKey();
  const service = new PromptsApiService();

  const getOptions: { version?: string } = {};
  if (options?.version !== undefined) {
    getOptions.version = options.version;
  }

  const prompt = await service.get(promptHandle, getOptions);

  if (!prompt) {
    console.error(chalk.red(`Error: Prompt not found: ${promptHandle}`));
    process.exit(1);
  }

  const versionId = prompt.versionId;
  await service.assignTag({ id: promptHandle, tag: tagName, versionId });

  console.log(
    chalk.green(
      `✓ Assigned tag '${tagName}' to ${promptHandle}@${prompt.version} (versionId: ${versionId})`,
    ),
  );
};

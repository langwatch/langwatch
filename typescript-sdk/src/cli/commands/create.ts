import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { FileManager } from "../utils/fileManager";
import { checkApiKey } from "../utils/apiKey";
import {
  commandValidationError,
  reportCommandError,
} from "../utils/errorOutput";
import { ensureProjectInitialized } from "../utils/init";
import { DEFAULT_PROMPT_MODEL } from "../constants";

interface CreateOptions {
  format?: string;
}

export const createCommand = async (
  name: string,
  options: CreateOptions = {},
): Promise<void> => {
  try {
    // Validate prompt name
    if (!name || name.trim() === "") {
      reportCommandError({
        error: commandValidationError("Prompt name cannot be empty"),
      });
      process.exit(1);
    }

    // Check API key before doing anything else
    checkApiKey();

    // Ensure project is initialized
    await ensureProjectInitialized();

    // Check if file already exists
    const promptPath = path.join(
      process.cwd(),
      "prompts",
      `${name}.prompt.yaml`,
    );

    if (fs.existsSync(promptPath)) {
      reportCommandError({
        error: commandValidationError(
          `Prompt file already exists at ${promptPath}`,
        ),
      });
      process.exit(1);
    }

    // Create prompts directory if it doesn't exist
    const promptsDir = path.dirname(promptPath);
    if (!fs.existsSync(promptsDir)) {
      fs.mkdirSync(promptsDir, { recursive: true });
    }

    // Default prompt content.
    //
    // No `modelParameters.temperature`: the latest model families (gpt-5+)
    // reject a custom temperature, so injecting one by default breaks the
    // very models a new prompt should be using. Add it back only for a model
    // that supports it.
    const defaultContent = `model: ${DEFAULT_PROMPT_MODEL}
messages:
  - role: system
    content: You are a helpful assistant.
  - role: user
    content: "{{input}}"
`;

    // Write the file
    fs.writeFileSync(promptPath, defaultContent, "utf8");

    // Add to prompts.json as a file: dependency
    const promptsConfig = FileManager.loadPromptsConfig();
    const relativePath = path.relative(process.cwd(), promptPath);
    promptsConfig.prompts[name] = `file:${relativePath}`;
    FileManager.savePromptsConfig(promptsConfig);

    // Update lock file
    const lock = FileManager.loadPromptsLock();
    lock.prompts[name] = {
      version: 0, // Local files start at version 0
      versionId: "local",
      materialized: relativePath, // Store the original file path
    };
    FileManager.savePromptsLock(lock);

    const displayPath = `./${relativePath}`;

    if (options.format === "json") {
      console.log(
        JSON.stringify(
          { name, path: relativePath, dependency: `file:${relativePath}` },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      chalk.green(`✓ Created prompt file: ${chalk.cyan(displayPath)}`),
    );
    console.log(chalk.gray(`  Edit this file and then run:`));
    console.log(chalk.cyan(`  langwatch prompt sync`));
  } catch (error) {
    reportCommandError({ error });
    process.exit(1);
  }
};

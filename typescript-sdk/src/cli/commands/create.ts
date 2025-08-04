import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { FileManager } from "../utils/fileManager";
import { checkApiKey } from "../utils/apiKey";
import { ensureProjectInitialized } from "../utils/init";

interface CreateOptions {
  // Future options can be added here
}

export const createCommand = async (name: string, options: CreateOptions): Promise<void> => {
  try {
    // Validate prompt name
    if (!name || name.trim() === "") {
      console.error(chalk.red("Error: Prompt name cannot be empty"));
      process.exit(1);
    }

    // Check API key before doing anything else
    checkApiKey();

    // Ensure project is initialized
    await ensureProjectInitialized();

    // Check if file already exists
    const promptPath = path.join(process.cwd(), "prompts", `${name}.prompt.yaml`);

    if (fs.existsSync(promptPath)) {
      console.error(chalk.red(`Error: Prompt file already exists at ${promptPath}`));
      process.exit(1);
    }

    // Create prompts directory if it doesn't exist
    const promptsDir = path.dirname(promptPath);
    if (!fs.existsSync(promptsDir)) {
      fs.mkdirSync(promptsDir, { recursive: true });
    }

    // Default prompt content
    const defaultContent = `model: openai/gpt-4o-mini
modelParameters:
  temperature: 0.7
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
    console.log(chalk.green(`✓ Created prompt file: ${chalk.cyan(displayPath)}`));
    console.log(chalk.gray(`  Edit this file and then run:`));
    console.log(chalk.cyan(`  langwatch prompt sync`));

  } catch (error) {
    console.error(chalk.red("Unexpected error:"), error instanceof Error ? error.message : error);
    process.exit(1);
  }
};
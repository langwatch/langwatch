import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { FileManager } from "../utils/fileManager";
import { PromptService, PromptsError } from "../../prompt/service";
import { PromptConverter } from "../../prompt/converter";
import { ensureProjectInitialized } from "../utils/init";
import { checkApiKey } from "../utils/apiKey";

interface AddOptions {
  version?: string;
  localFile?: string;
}

const addLocalFile = async (name: string, localFilePath: string): Promise<void> => {
  // Validate that the file exists and has the right extension
  if (!fs.existsSync(localFilePath)) {
    console.error(chalk.red(`Error: Local file not found: ${localFilePath}`));
    process.exit(1);
  }

  if (!localFilePath.endsWith('.prompt.yaml')) {
    console.error(chalk.red(`Error: Local file must have .prompt.yaml extension`));
    process.exit(1);
  }

  // Load and validate the YAML file
  try {
    const config = FileManager.loadLocalPrompt(localFilePath);

    // Ensure project is initialized
    await ensureProjectInitialized();

    // Add to prompts.json as a file: dependency
    const promptsConfig = FileManager.loadPromptsConfig();
    promptsConfig.prompts[name] = `file:${localFilePath}`;
    FileManager.savePromptsConfig(promptsConfig);

    // Update lock file
    const lock = FileManager.loadPromptsLock();
    lock.prompts[name] = {
      version: 0, // Local files start at version 0
      versionId: "local",
      materialized: localFilePath, // Store the original file path
    };
    FileManager.savePromptsLock(lock);

    console.log(chalk.green(`✓ Added local prompt: ${chalk.cyan(name)} → ${chalk.gray(localFilePath)}`));

  } catch (error) {
    console.error(chalk.red("Error loading local prompt file:"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
};

export const addCommand = async (name: string, options: AddOptions): Promise<void> => {
  try {
    // Validate prompt name
    if (!name || name.trim() === "") {
      console.error(chalk.red("Error: Prompt name cannot be empty"));
      process.exit(1);
    }

    // Handle local file addition
    if (options.localFile) {
      await addLocalFile(name, options.localFile);
      return;
    }

    // Check API key before doing anything else
    checkApiKey();

    const promptService = PromptService.getInstance();
    const version = options.version || "latest";

        // Fetch and materialize the prompt (like sync does for individual prompts)
    const spinner = ora(`Adding ${chalk.cyan(`${name}@${version}`)}...`).start();

    try {
      // Fetch the prompt from the API
      const prompt = await promptService.get(name);

      if (!prompt) {
        spinner.fail();
        console.error(chalk.red(`Error: Prompt "${name}" not found`));
        process.exit(1);
      }

      // Stop spinner before any user input prompts
      spinner.stop();

      // Ensure project is initialized (prompts.json, lock file, directories)
      await ensureProjectInitialized();

      // Restart spinner for the actual work
      spinner.start(`Adding ${chalk.cyan(`${name}@${version}`)}...`);

      // Convert to MaterializedPrompt format and save
      const materializedPrompt = PromptConverter.fromApiToMaterialized(prompt);
      const savedPath = FileManager.saveMaterializedPrompt(name, materializedPrompt);
      const relativePath = path.relative(process.cwd(), savedPath);

      // Load existing config and lock, add the new dependency
      const config = FileManager.loadPromptsConfig();
      const lock = FileManager.loadPromptsLock();

      config.prompts[name] = version;
      FileManager.updateLockEntry(lock, name, materializedPrompt, savedPath);

      // Save the updated config and lock
      FileManager.savePromptsConfig(config);
      FileManager.savePromptsLock(lock);

      spinner.succeed();

      // Show what was done (add ./ prefix for consistency)
      const displayPath = relativePath.startsWith('./') ? relativePath : `./${relativePath}`;
      console.log(chalk.green(`✓ Pulled ${chalk.cyan(`${name}@${version}`)} ${chalk.gray(`(version ${prompt.version})`)} → ${chalk.gray(displayPath)}`));

    } catch (error) {
      spinner.fail();
      if (error instanceof PromptsError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(chalk.red(`Error adding prompt: ${error instanceof Error ? error.message : "Unknown error"}`));
      }
      process.exit(1);
    }

  } catch (error) {
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(chalk.red(`Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`));
    }
    process.exit(1);
  }
};
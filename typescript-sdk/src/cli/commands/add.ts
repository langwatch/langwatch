import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { FileManager } from "../utils/fileManager";
import { PromptService, PromptsError } from "../../prompt/service";
import { PromptConverter } from "../../prompt/converter";

interface AddOptions {
  version?: string;
}

export const addCommand = async (name: string, options: AddOptions): Promise<void> => {
  try {
    // Validate prompt name
    if (!name || name.trim() === "") {
      console.error(chalk.red("Error: Prompt name cannot be empty"));
      process.exit(1);
    }

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

      // Ensure directories exist
      FileManager.ensureDirectories();

      // Convert to MaterializedPrompt format and save
      const materializedPrompt = PromptConverter.fromApiToMaterialized(prompt);
      const savedPath = FileManager.saveMaterializedPrompt(name, materializedPrompt);
      const relativePath = path.relative(process.cwd(), savedPath);

      // Load existing config and add the new dependency
      const config = FileManager.loadPromptsConfig();
      config.prompts[name] = version;

      // Save the updated config
      FileManager.savePromptsConfig(config);

      spinner.succeed();

      // Show what was done
      console.log(chalk.green(`✓ Pulled ${chalk.cyan(`${name}@${version}`)} ${chalk.gray(`(version ${prompt.version})`)} → ${chalk.gray(relativePath)}`));

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
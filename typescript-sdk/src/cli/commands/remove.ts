import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { FileManager } from "../utils/fileManager";
import { PromptService, PromptsError } from "../../prompt/service";

export const removeCommand = async (name: string): Promise<void> => {
  try {
    // Validate prompt name
    if (!name || name.trim() === "") {
      console.error(chalk.red("Error: Prompt name cannot be empty"));
      process.exit(1);
    }

    // Load existing config and lock
    const config = FileManager.loadPromptsConfig();
    const lock = FileManager.loadPromptsLock();

    // Check if prompt exists in dependencies
    if (!config.prompts[name]) {
      console.error(chalk.red(`Error: Prompt "${name}" not found in dependencies`));
      console.log(chalk.gray(`Available prompts: ${Object.keys(config.prompts).join(', ') || 'none'}`));
      process.exit(1);
    }

    const dependency = config.prompts[name];
    const isLocalPrompt = (typeof dependency === "string" && dependency.startsWith("file:")) ||
                         (typeof dependency === "object" && dependency.file);

    const spinner = ora(`Removing ${chalk.cyan(name)}...`).start();

    try {
      // Handle local prompts
      if (isLocalPrompt) {
        let localFilePath: string;

        if (typeof dependency === "string" && dependency.startsWith("file:")) {
          localFilePath = path.resolve(dependency.slice(5)); // Remove "file:" prefix
        } else if (typeof dependency === "object" && dependency.file) {
          localFilePath = path.resolve(dependency.file);
        } else {
          // Fallback: assume it's in the prompts directory
          localFilePath = path.join(FileManager.getPromptsDir(), `${name}.prompt.yaml`);
        }

        // Delete the local file if it exists
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
          const relativePath = path.relative(process.cwd(), localFilePath);
          spinner.succeed();
          console.log(chalk.green(`✓ Removed local file ${chalk.gray(relativePath)}`));
        } else {
          spinner.succeed();
          console.log(chalk.yellow(`⚠ Local file not found (already deleted?)`));
        }

        console.log(chalk.yellow(`⚠ Note: This prompt may still exist on the server. Visit LangWatch to fully delete it.`));
      }

      // Remove materialized file if it exists
      const lockEntry = lock.prompts[name];
      if (lockEntry?.materialized) {
        const materializedPath = path.resolve(lockEntry.materialized);
        if (fs.existsSync(materializedPath)) {
          fs.unlinkSync(materializedPath);

          // Clean up empty directories
          const materializedDir = path.dirname(materializedPath);
          const rootMaterializedDir = FileManager.getMaterializedDir();

          let currentDir = materializedDir;
          while (currentDir !== rootMaterializedDir && currentDir !== path.dirname(currentDir)) {
            try {
              const entries = fs.readdirSync(currentDir);
              if (entries.length === 0) {
                fs.rmdirSync(currentDir);
                currentDir = path.dirname(currentDir);
              } else {
                break;
              }
            } catch {
              break;
            }
          }
        }
      }

      // Remove from config and lock
      delete config.prompts[name];
      delete lock.prompts[name];

      // Save updated files
      FileManager.savePromptsConfig(config);
      FileManager.savePromptsLock(lock);

      if (!isLocalPrompt) {
        spinner.succeed();
        console.log(chalk.green(`✓ Removed ${chalk.cyan(name)} from dependencies`));
      }

    } catch (error) {
      spinner.fail();
      if (error instanceof PromptsError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(chalk.red(`Error removing prompt: ${error instanceof Error ? error.message : "Unknown error"}`));
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
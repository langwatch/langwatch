import * as readline from "readline";
import chalk from "chalk";
import { FileManager } from "./fileManager";

const promptUser = (question: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
};

export const initializeProject = async (): Promise<void> => {
  console.log(chalk.blue("Initializing LangWatch prompts project..."));

  // Initialize prompts.json
  const configResult = FileManager.initializePromptsConfig();
  if (configResult.created) {
    console.log(chalk.green(`✓ Created ${chalk.gray("./prompts.json")}`));

    // Ask about .gitignore
    const shouldAddGitignore = await promptUser(
      chalk.yellow("Add 'prompts/.materialized' to .gitignore? [Y/n]: ")
    );

    if (shouldAddGitignore === "" || shouldAddGitignore === "y" || shouldAddGitignore === "yes") {
      const gitignoreResult = FileManager.addToGitignore("prompts/.materialized");
      if (gitignoreResult.added) {
        if (gitignoreResult.existed) {
          console.log(chalk.green(`✓ Added ${chalk.gray("prompts/.materialized")} to existing .gitignore`));
        } else {
          console.log(chalk.green(`✓ Created .gitignore with ${chalk.gray("prompts/.materialized")}`));
        }
      } else {
        console.log(chalk.gray(`• ${chalk.gray("prompts/.materialized")} already in .gitignore`));
      }
    }
  } else {
    console.log(chalk.gray(`• prompts.json already exists`));
  }

  // Initialize lock file
  const lockResult = FileManager.initializePromptsLock();
  if (lockResult.created) {
    console.log(chalk.green(`✓ Created ${chalk.gray("./prompts-lock.json")}`));
  } else {
    console.log(chalk.gray(`• prompts-lock.json already exists`));
  }

  // Ensure directories exist
  FileManager.ensureDirectories();
  console.log(chalk.green(`✓ Created ${chalk.gray("./prompts/")} directory structure`));

  console.log(chalk.green("\n✨ Project initialized! You can now add prompts with:"));
  console.log(chalk.gray("  langwatch prompt add <name>"));
};

export const ensureProjectInitialized = async (shouldPromptForGitignore = true): Promise<{ configCreated: boolean; lockCreated: boolean }> => {
  // Initialize prompts.json
  const configResult = FileManager.initializePromptsConfig();
  let askedAboutGitignore = false;

  if (configResult.created) {
    console.log(chalk.green(`✓ Created ${chalk.gray("./prompts.json")}`));

    // Ask about .gitignore only if we should prompt and haven't asked yet
    if (shouldPromptForGitignore) {
      askedAboutGitignore = true;
      const shouldAddGitignore = await promptUser(
        chalk.yellow("Add 'prompts/.materialized' to .gitignore? [Y/n]: ")
      );

      if (shouldAddGitignore === "" || shouldAddGitignore === "y" || shouldAddGitignore === "yes") {
        const gitignoreResult = FileManager.addToGitignore("prompts/.materialized");
        if (gitignoreResult.added) {
          if (gitignoreResult.existed) {
            console.log(chalk.green(`✓ Added ${chalk.gray("prompts/.materialized")} to existing .gitignore`));
          } else {
            console.log(chalk.green(`✓ Created .gitignore with ${chalk.gray("prompts/.materialized")}`));
          }
        } else {
          console.log(chalk.gray(`• ${chalk.gray("prompts/.materialized")} already in .gitignore`));
        }
      }
    }
  }

  // Initialize lock file
  const lockResult = FileManager.initializePromptsLock();
  if (lockResult.created) {
    console.log(chalk.green(`✓ Created ${chalk.gray("./prompts-lock.json")}`));
  }

  // Ensure directories exist
  FileManager.ensureDirectories();

  return {
    configCreated: configResult.created,
    lockCreated: lockResult.created
  };
};
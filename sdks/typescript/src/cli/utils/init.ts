import chalk from "chalk";
import { FileManager } from "./fileManager";

export const initializeProject = async (): Promise<void> => {
  console.log(chalk.blue("Initializing LangWatch prompts project..."));

  // Initialize prompts.json
  const configResult = FileManager.initializePromptsConfig();
  if (configResult.created) {
    console.log(chalk.green(`✓ Created ${chalk.gray("./prompts.json")}`));

    const gitignoreResult = FileManager.addToGitignore("prompts/.materialized");
    if (gitignoreResult.added) {
      if (gitignoreResult.existed) {
        console.log(
          chalk.green(
            `✓ Added ${chalk.gray(
              "prompts/.materialized"
            )} to existing .gitignore`
          )
        );
      } else {
        console.log(
          chalk.green(
            `✓ Created .gitignore with ${chalk.gray("prompts/.materialized")}`
          )
        );
      }
    } else {
      console.log(
        chalk.gray(
          `• ${chalk.gray("prompts/.materialized")} already in .gitignore`
        )
      );
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
  console.log(
    chalk.green(`✓ Created ${chalk.gray("./prompts/")} directory structure`)
  );

  console.log(
    chalk.green("\n✨ Project initialized! You can now add prompts with:")
  );
  console.log(chalk.gray("  langwatch prompt add <name>"));
};

export const ensureProjectInitialized = async (
  shouldCheckForGitignore = true
): Promise<{ configCreated: boolean; lockCreated: boolean }> => {
  // Initialize prompts.json
  const configResult = FileManager.initializePromptsConfig();

  if (configResult.created) {
    console.log(chalk.green(`✓ Created ${chalk.gray("./prompts.json")}`));

    if (shouldCheckForGitignore) {
      const gitignoreResult = FileManager.addToGitignore(
        "prompts/.materialized"
      );
      if (gitignoreResult.added) {
        if (gitignoreResult.existed) {
          console.log(
            chalk.green(
              `✓ Added ${chalk.gray(
                "prompts/.materialized"
              )} to existing .gitignore`
            )
          );
        } else {
          console.log(
            chalk.green(
              `✓ Created .gitignore with ${chalk.gray("prompts/.materialized")}`
            )
          );
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
    lockCreated: lockResult.created,
  };
};

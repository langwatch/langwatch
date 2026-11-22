import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import type { Ora } from "ora";

import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { PromptsError } from "@/client-sdk/services/prompts";

import type { PromptDependency } from "../types";
import { FileManager } from "../utils/fileManager";
import { createSpinner } from "../utils/spinner";
import { failSpinner } from "../utils/spinnerError";

const localPromptPath = ({
  name,
  dependency,
}: {
  name: string;
  dependency: PromptDependency;
}): string => {
  if (typeof dependency === "string" && dependency.startsWith("file:")) {
    return path.resolve(dependency.slice(5)); // Remove "file:" prefix
  }
  if (typeof dependency === "object" && dependency.file) {
    return path.resolve(dependency.file);
  }
  return path.join(FileManager.getPromptsDir(), `${name}.prompt.yaml`);
};

const removeLocalPromptFile = ({
  name,
  dependency,
  spinner,
}: {
  name: string;
  dependency: PromptDependency;
  spinner: Ora;
}): void => {
  const localFilePath = localPromptPath({ name, dependency });
  if (fs.existsSync(localFilePath)) {
    fs.unlinkSync(localFilePath);
    const relativePath = path.relative(process.cwd(), localFilePath);
    spinner.succeed();
    console.log(chalk.green(`✓ Removed local file ${chalk.gray(relativePath)}`));
  } else {
    spinner.succeed();
    console.log(chalk.yellow(`⚠ Local file not found (already deleted?)`));
  }
  console.log(
    chalk.yellow(
      `⚠ Note: This prompt may still exist on the server. Visit LangWatch to fully delete it.`,
    ),
  );
};

const pruneEmptyDirectories = (startDir: string): void => {
  const rootMaterializedDir = FileManager.getMaterializedDir();
  let currentDir = startDir;
  while (currentDir !== rootMaterializedDir && currentDir !== path.dirname(currentDir)) {
    try {
      if (fs.readdirSync(currentDir).length !== 0) return;
      fs.rmdirSync(currentDir);
      currentDir = path.dirname(currentDir);
    } catch {
      return;
    }
  }
};

const removeMaterializedFile = (materialized: string): void => {
  const materializedPath = path.resolve(materialized);
  if (!fs.existsSync(materializedPath)) return;
  fs.unlinkSync(materializedPath);
  pruneEmptyDirectories(path.dirname(materializedPath));
};

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
      console.log(
        chalk.gray(`Available prompts: ${Object.keys(config.prompts).join(", ") || "none"}`),
      );
      process.exit(1);
    }

    const dependency = config.prompts[name];
    const isLocalPrompt =
      (typeof dependency === "string" && dependency.startsWith("file:")) ||
      (typeof dependency === "object" && dependency.file);

    const spinner = createSpinner(`Removing ${chalk.cyan(name)}...`).start();

    try {
      if (isLocalPrompt) removeLocalPromptFile({ name, dependency, spinner });

      const lockEntry = lock.prompts[name];
      if (lockEntry?.materialized) removeMaterializedFile(lockEntry.materialized);

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
      failSpinner({ spinner, error, action: "remove prompt" });
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(chalk.red(`Unexpected error: ${formatApiErrorMessage({ error })}`));
    }
    process.exit(1);
  }
};

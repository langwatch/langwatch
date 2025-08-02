import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { PromptConverter } from "../../prompt/converter";
import { PromptService, PromptsError } from "../../prompt/service";
import type { SyncResult } from "../types";
import { FileManager } from "../utils/fileManager";
import { ensureProjectInitialized } from "../utils/init";

export const syncCommand = async (): Promise<void> => {
  const startTime = Date.now();

  try {
        // Get prompt service
    const promptService = PromptService.getInstance();

    // Ensure project is initialized (prompts.json, lock file, directories)
    await ensureProjectInitialized(false); // Don't prompt for .gitignore in sync

    // Load prompts config and lock
    const config = FileManager.loadPromptsConfig();
    const lock = FileManager.loadPromptsLock();

    const result: SyncResult = {
      fetched: [],
      pushed: [],
      unchanged: [],
      cleaned: [],
      errors: [],
    };

    // Process remote prompts (fetch and materialize)
    const remoteDeps = Object.entries(config.prompts).filter(([, dependency]) => {
      // Skip local file dependencies (both object format and string format)
      if (typeof dependency === "object" && dependency.file) {
        return false;
      }
      if (typeof dependency === "string" && dependency.startsWith("file:")) {
        return false;
      }
      return true;
    });

        if (remoteDeps.length > 0) {
      const fetchSpinner = ora(`Checking ${remoteDeps.length} remote prompts...`).start();

      for (const [name, dependency] of remoteDeps) {
        try {
          const versionSpec = typeof dependency === "string" ? dependency : dependency.version || "latest";

          // Check if we already have this prompt with the same version
          const lockEntry = lock.prompts[name];

          // Fetch the prompt from the API to check current version
          const prompt = await promptService.get(name);

          if (prompt) {
            // Check if we need to update (new version or not materialized)
            const needsUpdate = !lockEntry ||
                               lockEntry.version !== prompt.version ||
                               !lockEntry.materialized ||
                               !fs.existsSync(path.resolve(lockEntry.materialized));

            if (needsUpdate) {
              // Convert to MaterializedPrompt format using the converter
              const materializedPrompt = PromptConverter.fromApiToMaterialized(prompt);

              const savedPath = FileManager.saveMaterializedPrompt(name, materializedPrompt);
              const relativePath = path.relative(process.cwd(), savedPath);
              result.fetched.push(name); // Store the name, not path

              // Update lock file entry
              FileManager.updateLockEntry(lock, name, materializedPrompt, savedPath);

              fetchSpinner.text = `Fetched ${chalk.cyan(`${name}@${versionSpec}`)} ${chalk.gray(`(version ${prompt.version})`)} → ${chalk.gray(relativePath)}`;
            } else {
              // No change needed, track as unchanged
              result.unchanged.push(name);
            }
          } else {
            result.errors.push({ name, error: "Prompt not found" });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ name, error: errorMessage });
        }
      }

      fetchSpinner.stop();
    }

        // Process local prompts (push to API) - only those explicitly declared in prompts.json
    const localFileRefs = Object.entries(config.prompts).filter(([, dependency]) => {
      return typeof dependency === "string" && dependency.startsWith("file:");
    });

    if (localFileRefs.length > 0) {
      const pushSpinner = ora(`Pushing ${localFileRefs.length} local prompts...`).start();

      for (const [promptName, dependency] of localFileRefs) {
        try {
          const filePath = (dependency as string).slice(5); // Remove "file:" prefix

          // Load local prompt config
          const localConfig = FileManager.loadLocalPrompt(filePath);

          // Convert local config to API format and push using PromptService.upsert
          const apiConfig = PromptConverter.fromLocalToApiFormat(localConfig);
          const upsertResult = await promptService.upsert(promptName, apiConfig);

          const relativePath = path.relative(process.cwd(), filePath);
          result.pushed.push(promptName); // Store the name, not path

          const action = upsertResult.created ? "Created" : "Updated";
          pushSpinner.text = `${action} ${chalk.cyan(promptName)} ${chalk.gray(`(version ${upsertResult.prompt.version})`)} from ${chalk.gray(relativePath)}`;

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ name: promptName, error: errorMessage });
        }
      }

      pushSpinner.stop();
    }

    // Check for orphan local prompt files and show helpful warnings
    const discoveredLocalFiles = FileManager.getLocalPromptFiles();
    const orphanFiles = discoveredLocalFiles.filter(filePath => {
      const promptName = FileManager.promptNameFromPath(filePath);
      return !config.prompts[promptName]; // Not declared in prompts.json
    });

    if (orphanFiles.length > 0) {
      console.log(chalk.yellow(`\n⚠ Found ${orphanFiles.length} orphan prompt file${orphanFiles.length > 1 ? 's' : ''}:`));

      for (const filePath of orphanFiles) {
        const promptName = FileManager.promptNameFromPath(filePath);
        const relativePath = path.relative(process.cwd(), filePath);

        console.log(chalk.yellow(`  ${relativePath}`));
        console.log(chalk.gray(`    Add to prompts.json: "${promptName}": "file:${relativePath}"`));
      }

      console.log(chalk.gray(`\nTip: Add these to prompts.json to include them in sync operations.`));
    }

    // Cleanup orphaned materialized files
    const currentDependencies = new Set(Object.keys(config.prompts).filter(name => {
      const dependency = config.prompts[name];
      // Only include remote dependencies (not local file: dependencies)
      if (typeof dependency === "object" && dependency.file) {
        return false;
      }
      if (typeof dependency === "string" && dependency.startsWith("file:")) {
        return false;
      }
      return true;
    }));

    const cleanedFiles = FileManager.cleanupOrphanedMaterializedFiles(currentDependencies);
    if (cleanedFiles.length > 0) {
      result.cleaned = cleanedFiles;
      FileManager.removeFromLock(lock, cleanedFiles);
    }

    // Save the updated lock file
    FileManager.savePromptsLock(lock);

        // Print individual results if there were actions
    if (result.fetched.length > 0) {
      for (const name of result.fetched) {
        // Get the actual saved path from lock file for display consistency
        const lockEntry = lock.prompts[name];
        const displayPath = lockEntry?.materialized ? `./${lockEntry.materialized}` : `./prompts/.materialized/${name}.prompt.yaml`;

        // Get version info for display (like add command)
        const dependency = config.prompts[name];
        const versionSpec = typeof dependency === "string" ? dependency : dependency?.version || "latest";
        const actualVersion = lockEntry?.version || "unknown";

        console.log(chalk.green(`✓ Pulled ${chalk.cyan(`${name}@${versionSpec}`)} ${chalk.gray(`(version ${actualVersion})`)} → ${chalk.gray(displayPath)}`));
      }
    }

    if (result.pushed.length > 0) {
      for (const name of result.pushed) {
        const localPath = `./prompts/${name}.prompt.yaml`;
        console.log(chalk.green(`✓ Pushed ${chalk.cyan(name)} from ${chalk.gray(localPath)}`));
      }
    }

    // Print cleaned up files
    if (result.cleaned.length > 0) {
      for (const name of result.cleaned) {
        console.log(chalk.yellow(`✓ Cleaned ${chalk.cyan(name)} (no longer in dependencies)`));
      }
    }

    // Print errors
    if (result.errors.length > 0) {
      for (const { name, error } of result.errors) {
        console.log(chalk.red(`✗ Failed ${chalk.cyan(name)}: ${error}`));
      }
    }

            // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalActions = result.fetched.length + result.pushed.length + result.cleaned.length;

    if (totalActions === 0 && result.errors.length === 0) {
      console.log(chalk.gray(`Synced in ${duration}s`));
    } else {
      const summary = [];
      if (result.fetched.length > 0) summary.push(`${result.fetched.length} fetched`);
      if (result.pushed.length > 0) summary.push(`${result.pushed.length} pushed`);
      if (result.cleaned.length > 0) summary.push(`${result.cleaned.length} cleaned`);
      if (result.errors.length > 0) summary.push(`${result.errors.length} errors`);

      console.log(chalk.gray(`Synced ${summary.join(', ')} in ${duration}s`));
    }

    if (result.errors.length > 0) {
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
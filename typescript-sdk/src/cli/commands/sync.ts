import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import * as yaml from "js-yaml";
import { PromptConverter } from "../../prompt/converter";
import { ConfigData, PromptService, PromptsError } from "../../prompt/service";
import type { SyncResult } from "../types";
import { FileManager } from "../utils/fileManager";
import { ensureProjectInitialized } from "../utils/init";
import { checkApiKey } from "../utils/apiKey";

// Handle conflict resolution - show diff and ask user to choose
const handleConflict = async (
  promptName: string,
  conflictInfo: {
    localVersion: number;
    remoteVersion: number;
    differences: string[];
    remoteConfigData: any;
  },
): Promise<"local" | "remote" | "abort"> => {
  console.log(
    chalk.yellow(
      `\n⚠ Conflict detected for prompt: ${chalk.cyan(promptName)}`,
    ),
  );
  console.log(
    chalk.gray(
      `Local version: ${conflictInfo.localVersion}, Remote version: ${conflictInfo.remoteVersion}`,
    ),
  );

  if (conflictInfo.differences.length > 0) {
    console.log(chalk.yellow("\nDifferences:"));
    conflictInfo.differences.forEach((diff) => {
      console.log(chalk.gray(`  • ${diff}`));
    });
  }

  console.log(chalk.yellow("\nOptions:"));
  console.log("  [l] Use local version (overwrite remote)");
  console.log("  [r] Use remote version (overwrite local)");
  console.log("  [a] Abort sync for this prompt");

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Choose resolution (l/r/a): ", (answer: string) => {
      rl.close();
      const choice = answer.toLowerCase();
      if (choice === "l" || choice === "local") {
        resolve("local");
      } else if (choice === "r" || choice === "remote") {
        resolve("remote");
      } else {
        resolve("abort");
      }
    });
  });
};

export const syncCommand = async (): Promise<void> => {
  const startTime = Date.now();

  try {
    // Check API key before doing anything else
    checkApiKey();

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
    const remoteDeps = Object.entries(config.prompts).filter(
      ([, dependency]) => {
        // Skip local file dependencies (both object format and string format)
        if (typeof dependency === "object" && dependency.file) {
          return false;
        }
        if (typeof dependency === "string" && dependency.startsWith("file:")) {
          return false;
        }
        return true;
      },
    );

    if (remoteDeps.length > 0) {
      const fetchSpinner = ora(
        `Checking ${remoteDeps.length} remote prompts...`,
      ).start();

      for (const [name, dependency] of remoteDeps) {
        try {
          const versionSpec =
            typeof dependency === "string"
              ? dependency
              : dependency.version || "latest";

          // Check if we already have this prompt with the same version
          const lockEntry = lock.prompts[name];

          // Fetch the prompt from the API to check current version
          const prompt = await promptService.get(name);

          if (prompt) {
            // Check if we need to update (new version or not materialized)
            const needsUpdate =
              !lockEntry ||
              lockEntry.version !== prompt.version ||
              !lockEntry.materialized ||
              !fs.existsSync(path.resolve(lockEntry.materialized));

            if (needsUpdate) {
              // Convert to MaterializedPrompt format using the converter
              const materializedPrompt =
                PromptConverter.fromApiToMaterialized(prompt);

              const savedPath = FileManager.saveMaterializedPrompt(
                name,
                materializedPrompt,
              );
              const relativePath = path.relative(process.cwd(), savedPath);
              result.fetched.push({
                name,
                version: prompt.version,
                versionSpec,
              });

              // Update lock file entry
              FileManager.updateLockEntry(
                lock,
                name,
                materializedPrompt,
                savedPath,
              );

              fetchSpinner.text = `Fetched ${chalk.cyan(
                `${name}@${versionSpec}`,
              )} ${chalk.gray(`(version ${prompt.version})`)} → ${chalk.gray(
                relativePath,
              )}`;
            } else {
              // No change needed, track as unchanged
              result.unchanged.push(name);
            }
          } else {
            result.errors.push({ name, error: "Prompt not found" });
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ name, error: errorMessage });
        }
      }

      fetchSpinner.stop();
    }

    // Process local prompts (push to API) - only those explicitly declared in prompts.json
    const localFileRefs = Object.entries(config.prompts).filter(
      ([, dependency]) => {
        return typeof dependency === "string" && dependency.startsWith("file:");
      },
    );

    if (localFileRefs.length > 0) {
      const pushSpinner = ora(
        `Pushing ${localFileRefs.length} local prompts...`,
      ).start();

      // Use the existing lock file instead of reloading it
      // const lock = FileManager.loadPromptsLock(); // Don't reload - use existing lock

      for (const [promptName, dependency] of localFileRefs) {
        try {
          const filePath = (dependency as string).slice(5); // Remove "file:" prefix

          // Load local prompt config
          const localConfig = FileManager.loadLocalPrompt(filePath);

          // Get current version from lock file
          const currentVersion = lock.prompts[promptName]?.version;

          // Convert local config to API configData format
          const configData: ConfigData = {
            model: localConfig.model,
            prompt: PromptConverter.extractSystemPrompt(localConfig.messages),
            messages: PromptConverter.filterNonSystemMessages(
              localConfig.messages,
            ) as Array<{
              role: "system" | "user" | "assistant";
              content: string;
            }>,
            temperature: localConfig.modelParameters?.temperature,
            max_tokens: localConfig.modelParameters?.max_tokens,
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          };

          // Use new sync API with conflict detection
          const syncResult = await promptService.sync({
            name: promptName,
            configData,
            localVersion: currentVersion,
            commitMessage: `Synced from local file: ${path.basename(filePath)}`,
          });

          const relativePath = path.relative(process.cwd(), filePath);

          let conflictResolution: "local" | "remote" | "abort" | null = null;
          if (syncResult.action === "conflict") {
            // Handle conflict - prompt user for resolution
            pushSpinner.stop();
            conflictResolution = await handleConflict(
              promptName,
              syncResult.conflictInfo!,
            );
            if (conflictResolution === "abort") {
              result.errors.push({
                name: promptName,
                error: "Sync aborted due to conflict",
              });
              continue;
            }

            // If user chose remote, we should pull the remote version to local file
            if (conflictResolution === "remote" && syncResult.conflictInfo) {
              // Update local file with remote content
              const remoteConfig = {
                model: syncResult.conflictInfo.remoteConfigData.model,
                modelParameters: {
                  temperature:
                    syncResult.conflictInfo.remoteConfigData.temperature,
                  max_tokens:
                    syncResult.conflictInfo.remoteConfigData.max_tokens,
                },
                messages: [
                  {
                    role: "system" as const,
                    content: syncResult.conflictInfo.remoteConfigData.prompt,
                  },
                  ...(syncResult.conflictInfo.remoteConfigData.messages ?? []),
                ],
              };

              const yamlContent = yaml.dump(remoteConfig, {
                lineWidth: -1,
                noRefs: true,
                sortKeys: false,
              });

              fs.writeFileSync(filePath, yamlContent);
            }

            // If user chose to proceed, we continue with the sync
            pushSpinner.start();
          }

          // Update lock file with new version info
          if (syncResult.prompt) {
            lock.prompts[promptName] = {
              version: syncResult.prompt.version,
              versionId: syncResult.prompt.versionId,
              materialized: filePath,
            };
          } else if (syncResult.action === "conflict") {
            const remoteVersion = syncResult.conflictInfo?.remoteVersion ?? 0;
            if (conflictResolution === "remote") {
              // User chose remote - use remote version
              lock.prompts[promptName] = {
                version: remoteVersion,
                versionId: "remote_version", // We don't have the actual versionId from conflict info
                materialized: filePath,
              };
            } else {
              // User chose local - create new version (remote + 1)
              lock.prompts[promptName] = {
                version: remoteVersion + 1,
                versionId: "conflict_resolved", // Temporary until we get actual versionId
                materialized: filePath,
              };
            }
          }

          // Determine the action text based on sync result and conflict resolution
          let actionText: string;
          if (syncResult.action === "conflict") {
            if (conflictResolution === "remote") {
              actionText = "Pulled"; // User chose to use remote version
              result.fetched.push({
                name: promptName,
                version: syncResult.conflictInfo?.remoteVersion || 0,
                versionSpec: "latest", // Default for conflict resolution
              });
            } else {
              actionText = "Pushed"; // User chose to use local version (or forced push)
              result.pushed.push({
                name: promptName,
                version: (syncResult.conflictInfo?.remoteVersion || 0) + 1, // New version after push
              });
            }
          } else if (syncResult.action === "up_to_date") {
            // For up-to-date prompts, add to unchanged instead of pushed
            actionText = "Up-to-date";
            result.unchanged.push(promptName);
          } else {
            actionText =
              {
                created: "Created",
                updated: "Updated",
              }[syncResult.action] || "Pushed";
            result.pushed.push({
              name: promptName,
              version: syncResult.prompt?.version || 0,
            });
          }

          pushSpinner.text = `${actionText} ${chalk.cyan(
            promptName,
          )} ${chalk.gray(
            `(version ${
              syncResult.prompt?.version ||
              syncResult.conflictInfo?.remoteVersion ||
              "unknown"
            })`,
          )} ${conflictResolution === "remote" ? "to" : "from"} ${chalk.gray(
            relativePath,
          )}`;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          result.errors.push({ name: promptName, error: errorMessage });
        }
      }

      // Save lock file with all updates
      FileManager.savePromptsLock(lock);

      pushSpinner.stop();
    }

    // Check for orphan local prompt files and show helpful warnings
    const discoveredLocalFiles = FileManager.getLocalPromptFiles();
    const orphanFiles = discoveredLocalFiles.filter((filePath) => {
      const promptName = FileManager.promptNameFromPath(filePath);
      return !config.prompts[promptName]; // Not declared in prompts.json
    });

    if (orphanFiles.length > 0) {
      console.log(
        chalk.yellow(
          `\n⚠ Found ${orphanFiles.length} orphan prompt file${
            orphanFiles.length > 1 ? "s" : ""
          }:`,
        ),
      );

      for (const filePath of orphanFiles) {
        const promptName = FileManager.promptNameFromPath(filePath);
        const relativePath = path.relative(process.cwd(), filePath);

        console.log(chalk.yellow(`  ${relativePath}`));
        console.log(
          chalk.gray(
            `    Add to prompts.json: "${promptName}": "file:${relativePath}"`,
          ),
        );
      }

      console.log(
        chalk.gray(
          `\nTip: Add these to prompts.json to include them in sync operations.`,
        ),
      );
    }

    // Cleanup orphaned materialized files
    const currentDependencies = new Set(
      Object.keys(config.prompts).filter((name) => {
        const dependency = config.prompts[name];
        // Only include remote dependencies (not local file: dependencies)
        if (typeof dependency === "object" && dependency.file) {
          return false;
        }
        if (typeof dependency === "string" && dependency.startsWith("file:")) {
          return false;
        }
        return true;
      }),
    );

    const cleanedFiles =
      FileManager.cleanupOrphanedMaterializedFiles(currentDependencies);
    if (cleanedFiles.length > 0) {
      result.cleaned = cleanedFiles;
      FileManager.removeFromLock(lock, cleanedFiles);
    }

    // Save the updated lock file
    FileManager.savePromptsLock(lock);

    // Print individual results if there were actions
    if (result.fetched.length > 0) {
      for (const { name, version, versionSpec } of result.fetched) {
        // Get the actual saved path from lock file for display consistency
        const lockEntry = lock.prompts[name];
        const displayPath = lockEntry?.materialized
          ? `./${lockEntry.materialized}`
          : `./prompts/.materialized/${name}.prompt.yaml`;

        console.log(
          chalk.green(
            `✓ Pulled ${chalk.cyan(`${name}@${versionSpec}`)} ${chalk.gray(
              `(version ${version})`,
            )} → ${chalk.gray(displayPath)}`,
          ),
        );
      }
    }

    if (result.pushed.length > 0) {
      for (const { name, version } of result.pushed) {
        const localPath = `./prompts/${name}.prompt.yaml`;
        console.log(
          chalk.green(
            `✓ Pushed ${chalk.cyan(name)} ${chalk.gray(`(version ${version})`)} from ${chalk.gray(localPath)}`,
          ),
        );
      }
    }

    // Print cleaned up files
    if (result.cleaned.length > 0) {
      for (const name of result.cleaned) {
        console.log(
          chalk.yellow(
            `✓ Cleaned ${chalk.cyan(name)} (no longer in dependencies)`,
          ),
        );
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
    const totalActions =
      result.fetched.length + result.pushed.length + result.cleaned.length;

    if (totalActions === 0 && result.errors.length === 0) {
      console.log(chalk.gray(`Synced in ${duration}s, no changes`));
    } else {
      const summary = [];
      if (result.fetched.length > 0)
        summary.push(`${result.fetched.length} fetched`);
      if (result.pushed.length > 0)
        summary.push(`${result.pushed.length} pushed`);
      if (result.cleaned.length > 0)
        summary.push(`${result.cleaned.length} cleaned`);
      if (result.errors.length > 0)
        summary.push(`${result.errors.length} errors`);

      console.log(chalk.gray(`Synced ${summary.join(", ")} in ${duration}s`));
    }

    if (result.errors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof PromptsError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Unexpected error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ),
      );
    }
    process.exit(1);
  }
};

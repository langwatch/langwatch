import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import * as yaml from "js-yaml";
import { PromptConverter } from "@/cli/utils/promptConverter";
import {
  type ConfigData,
  PromptsApiService,
  PromptsError,
  type SyncAction,
} from "@/client-sdk/services/prompts";
import type { PromptsConfig, PromptsLock, SyncResult } from "../types";
import { FileManager } from "../utils/fileManager";
import { ensureProjectInitialized } from "../utils/init";
import { checkApiKey } from "../utils/apiKey";
import readline from "node:readline";

// Handle conflict resolution - show diff and ask user to choose
const handleConflict = async (
  promptName: string,
  conflictInfo: {
    localVersion: number;
    remoteVersion: number;
    differences: string[];
    remoteConfigData: any;
  }
): Promise<"local" | "remote" | "abort"> => {
  console.log(
    chalk.yellow(`\n⚠ Conflict detected for prompt: ${chalk.cyan(promptName)}`)
  );
  console.log(
    chalk.gray(
      `Local version: ${conflictInfo.localVersion}, Remote version: ${conflictInfo.remoteVersion}`
    )
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
  console.log("  [a] Abort push for this prompt");

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

/**
 * Core push logic: pushes local prompts to the server.
 * Returns the result and mutates the lock object in place.
 */
export const pushPrompts = async ({
  config,
  lock,
  promptsApiService,
  result,
}: {
  config: PromptsConfig;
  lock: PromptsLock;
  promptsApiService: PromptsApiService;
  result: SyncResult;
}): Promise<void> => {
  const localFileRefs = Object.entries(config.prompts).filter(
    ([, dependency]) => {
      return typeof dependency === "string" && dependency.startsWith("file:");
    }
  );

  if (localFileRefs.length > 0) {
    const pushSpinner = ora(
      `Pushing ${localFileRefs.length} local prompts...`
    ).start();

    for (const [promptName, dependency] of localFileRefs) {
      try {
        const filePath = (dependency as string).slice(5); // Remove "file:" prefix

        const localConfig = FileManager.loadLocalPrompt(filePath);

        const currentVersion = lock.prompts[promptName]?.version;

        // Build outputs based on response_format if present
        const responseFormat = (localConfig as any).response_format;
        let outputs: ConfigData["outputs"] = [{ identifier: "output", type: "str" }];
        if (responseFormat?.schema) {
          outputs = [
            {
              identifier: responseFormat.name ?? "output",
              type: "json_schema",
              json_schema: responseFormat.schema,
            },
          ];
        }

        const configData: ConfigData = {
          model: localConfig.model,
          prompt: PromptConverter.extractSystemPrompt(localConfig.messages),
          messages: PromptConverter.filterNonSystemMessages(
            localConfig.messages
          ) as Array<{
            role: "system" | "user" | "assistant";
            content: string;
          }>,
          temperature: localConfig.modelParameters?.temperature,
          max_tokens: localConfig.modelParameters?.max_tokens,
          inputs: [{ identifier: "input", type: "str" }],
          outputs,
          // response_format is derived from outputs on the server side
        };

        const syncResult = await promptsApiService.sync({
          name: promptName,
          configData,
          localVersion: currentVersion,
          commitMessage: `Synced from local file: ${path.basename(filePath)}`,
        });

        const relativePath = path.relative(process.cwd(), filePath);

        let conflictResolution: "local" | "remote" | "abort" | null = null;
        if (syncResult.action === "conflict") {
          pushSpinner.stop();
          conflictResolution = await handleConflict(
            promptName,
            syncResult.conflictInfo!
          );
          if (conflictResolution === "abort") {
            result.errors.push({
              name: promptName,
              error: "Push aborted due to conflict",
            });
            continue;
          }

          if (conflictResolution === "remote" && syncResult.conflictInfo) {
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

          pushSpinner.start();
        }

        if (syncResult.prompt) {
          lock.prompts[promptName] = {
            version: syncResult.prompt.version,
            versionId: syncResult.prompt.versionId,
            materialized: filePath,
          };
        } else if (syncResult.action === "conflict") {
          const remoteVersion = syncResult.conflictInfo?.remoteVersion ?? 0;
          if (conflictResolution === "remote") {
            lock.prompts[promptName] = {
              version: remoteVersion,
              versionId: "remote_version",
              materialized: filePath,
            };
          } else {
            const formattedConfig = PromptConverter.fromLocalToApiFormat(localConfig);
            const updatedPrompt = await promptsApiService.update(promptName, {
              ...formattedConfig,
              commitMessage: `Updated via CLI: synced from local file`
            });
            lock.prompts[promptName] = {
              version: updatedPrompt.version,
              versionId: updatedPrompt.versionId,
              materialized: filePath,
            };
          }
        }

        let actionText: string;
        if (syncResult.action === "conflict") {
          if (conflictResolution === "remote") {
            actionText = "Pulled";
            result.fetched.push({
              name: promptName,
              version: syncResult.conflictInfo?.remoteVersion ?? 0,
              versionSpec: "latest",
            });
          } else {
            actionText = "Pushed";
            result.pushed.push({
              name: promptName,
              version: (syncResult.conflictInfo?.remoteVersion ?? 0) + 1,
            });
          }
        } else if (syncResult.action === "up_to_date") {
          actionText = "Up-to-date";
          result.unchanged.push(promptName);
        } else {
          const actionMap: Record<SyncAction, string> = {
            created: "Created",
            updated: "Updated",
            conflict: "Conflict resolved",
            up_to_date: "Up to date",
          };
          actionText = actionMap[syncResult.action as SyncAction] || "Pushed";
          result.pushed.push({
            name: promptName,
            version: syncResult.prompt?.version ?? 0,
          });
        }

        pushSpinner.text = `${actionText} ${chalk.cyan(
          promptName
        )} ${chalk.gray(
          `(version ${
            syncResult.prompt?.version ??
            syncResult.conflictInfo?.remoteVersion ??
            "unknown"
          })`
        )} ${conflictResolution === "remote" ? "to" : "from"} ${chalk.gray(
          relativePath
        )}`;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        result.errors.push({ name: promptName, error: errorMessage });
      }
    }

    pushSpinner.stop();
  }

  // Check for orphan local prompt files and show helpful warnings
  const discoveredLocalFiles = FileManager.getLocalPromptFiles();
  const orphanFiles = discoveredLocalFiles.filter((filePath) => {
    const promptName = FileManager.promptNameFromPath(filePath);
    return !config.prompts[promptName];
  });

  if (orphanFiles.length > 0) {
    console.log(
      chalk.yellow(
        `\n⚠ Found ${orphanFiles.length} orphan prompt file${
          orphanFiles.length > 1 ? "s" : ""
        }:`
      )
    );

    for (const filePath of orphanFiles) {
      const promptName = FileManager.promptNameFromPath(filePath);
      const relativePath = path.relative(process.cwd(), filePath);

      console.log(chalk.yellow(`  ${relativePath}`));
      console.log(
        chalk.gray(
          `    Add to prompts.json: "${promptName}": "file:${relativePath}"`
        )
      );
    }

    console.log(
      chalk.gray(
        `\nTip: Add these to prompts.json to include them in push operations.`
      )
    );
  }
};

const printPushResults = ({
  result,
  duration,
}: {
  result: SyncResult;
  duration: string;
}): void => {
  if (result.pushed.length > 0) {
    for (const { name, version } of result.pushed) {
      const localPath = `./prompts/${name}.prompt.yaml`;
      console.log(
        chalk.green(
          `✓ Pushed ${chalk.cyan(name)} ${chalk.gray(
            `(version ${version})`
          )} from ${chalk.gray(localPath)}`
        )
      );
    }
  }

  if (result.fetched.length > 0) {
    for (const { name, version } of result.fetched) {
      console.log(
        chalk.green(
          `✓ Pulled ${chalk.cyan(name)} ${chalk.gray(
            `(version ${version})`
          )} (resolved conflict with remote)`
        )
      );
    }
  }

  if (result.errors.length > 0) {
    for (const { name, error } of result.errors) {
      console.log(chalk.red(`✗ Failed ${chalk.cyan(name)}: ${error}`));
    }
  }

  const totalActions = result.fetched.length + result.pushed.length;

  if (totalActions === 0 && result.errors.length === 0) {
    console.log(chalk.gray(`Pushed in ${duration}s, no changes`));
  } else {
    const summary = [];
    if (result.pushed.length > 0)
      summary.push(`${result.pushed.length} pushed`);
    if (result.fetched.length > 0)
      summary.push(`${result.fetched.length} pulled (conflict resolution)`);
    if (result.errors.length > 0)
      summary.push(`${result.errors.length} errors`);

    console.log(chalk.gray(`Pushed ${summary.join(", ")} in ${duration}s`));
  }
};

export const pushCommand = async (): Promise<void> => {
  console.log("⬆️  Pushing local prompts...");

  const startTime = Date.now();

  try {
    checkApiKey();

    const promptsApiService = new PromptsApiService();

    await ensureProjectInitialized(false);

    const config = FileManager.loadPromptsConfig();
    const lock = FileManager.loadPromptsLock();

    const result: SyncResult = {
      fetched: [],
      pushed: [],
      unchanged: [],
      cleaned: [],
      errors: [],
    };

    await pushPrompts({ config, lock, promptsApiService, result });

    FileManager.savePromptsLock(lock);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    printPushResults({ result, duration });

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
          }`
        )
      );
    }
    process.exit(1);
  }
};

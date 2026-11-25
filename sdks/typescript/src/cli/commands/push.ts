import * as fs from "fs";
import readline from "node:readline";
import * as path from "path";

import chalk from "chalk";
import * as yaml from "js-yaml";
import type { Ora } from "ora";

import { PromptConverter } from "@/cli/utils/promptConverter";
import { responseFormatToOutputs } from "@/cli/utils/responseFormat";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import {
  type ConfigData,
  PromptsApiService,
  PromptsError,
  type SyncAction,
} from "@/client-sdk/services/prompts";

import type { PromptsConfig, PromptsLock, SyncResult } from "../types";
import { resolveCredentials } from "../utils/apiKey";
import { FileManager } from "../utils/fileManager";
import { ensureProjectInitialized } from "../utils/init";
import { createSpinner } from "../utils/spinner";

// Handle conflict resolution - show diff and ask user to choose
const handleConflict = async (
  promptName: string,
  conflictInfo: {
    localVersion: number;
    remoteVersion: number;
    differences: string[];
    remoteConfigData: unknown;
  },

  forceResolution?: "local" | "remote",
): Promise<"local" | "remote" | "abort"> => {
  console.log(chalk.yellow(`\n⚠ Conflict detected for prompt: ${chalk.cyan(promptName)}`));
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

  // Auto-resolve if --force-local or --force-remote was passed
  if (forceResolution) {
    console.log(
      chalk.yellow(
        `\nAuto-resolving conflict: using ${forceResolution} version (--force-${forceResolution})`,
      ),
    );
    return forceResolution;
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

type LocalPromptConfig = ReturnType<typeof FileManager.loadLocalPrompt>;
type PromptSyncResult = Awaited<ReturnType<PromptsApiService["sync"]>>;
type ConflictResolution = "local" | "remote" | "abort" | null;

const configDataFrom = (localConfig: LocalPromptConfig): ConfigData => {
  // Build outputs from the local response_format block. A flat object
  // schema expands back into flat platform fields; a richer schema is
  // preserved verbatim as one json_schema output. Exact inverse of the
  // pull direction (outputsToResponseFormat) so push/pull is lossless.
  const outputs: ConfigData["outputs"] = (responseFormatToOutputs(
    localConfig.response_format,
  ) as ConfigData["outputs"]) ?? [{ identifier: "output", type: "str" }];

  const configData: ConfigData = {
    model: localConfig.model,
    prompt: PromptConverter.extractSystemPrompt(localConfig.messages),
    messages: PromptConverter.filterNonSystemMessages(localConfig.messages) as {
      role: "system" | "user" | "assistant";
      content: string;
    }[],
    temperature: localConfig.modelParameters?.temperature,
    max_tokens: localConfig.modelParameters?.max_tokens,
    inputs: [{ identifier: "input", type: "str" }],
    outputs,
    // response_format is derived from outputs on the server side
  };

  return configData;
};

const writeRemotePrompt = ({
  filePath,
  conflictInfo,
}: {
  filePath: string;
  conflictInfo: NonNullable<PromptSyncResult["conflictInfo"]>;
}): void => {
  const remoteParameters = conflictInfo.remoteParameters ?? {};
  const remotePrompt = {
    model: conflictInfo.remoteConfigData.model,
    modelParameters: {
      temperature: conflictInfo.remoteConfigData.temperature,
      max_tokens: conflictInfo.remoteConfigData.max_tokens,
    },
    messages: [
      {
        role: "system" as const,
        content: conflictInfo.remoteConfigData.prompt,
      },
      ...(conflictInfo.remoteConfigData.messages ?? []),
    ],
    // Only write `parameters` when present, matching
    // PromptConverter.fromMaterializedToYaml — avoids writing an
    // empty `parameters: {}` into prompt files that have none.
    ...(Object.keys(remoteParameters).length > 0 ? { parameters: remoteParameters } : {}),
  };

  const yamlContent = yaml.dump(remotePrompt, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(filePath, yamlContent);
};

const recordLockEntry = async ({
  promptName,
  filePath,
  localConfig,
  syncResult,
  conflictResolution,
  lock,
  promptsApiService,
}: {
  promptName: string;
  filePath: string;
  localConfig: LocalPromptConfig;
  syncResult: PromptSyncResult;
  conflictResolution: ConflictResolution;
  lock: PromptsLock;
  promptsApiService: PromptsApiService;
}): Promise<void> => {
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
        commitMessage: `Updated via CLI: synced from local file`,
      });
      lock.prompts[promptName] = {
        version: updatedPrompt.version,
        versionId: updatedPrompt.versionId,
        materialized: filePath,
      };
    }
  }
};

/** Records what the sync did in the result, and names it for the spinner. */
const recordAction = ({
  promptName,
  syncResult,
  conflictResolution,
  result,
}: {
  promptName: string;
  syncResult: PromptSyncResult;
  conflictResolution: ConflictResolution;
  result: SyncResult;
}): string => {
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
  return actionText;
};

const pushLocalPrompt = async ({
  promptName,
  filePath,
  lock,
  promptsApiService,
  result,
  forceResolution,
  pushSpinner,
}: {
  promptName: string;
  filePath: string;
  lock: PromptsLock;
  promptsApiService: PromptsApiService;
  result: SyncResult;
  forceResolution?: "local" | "remote";
  pushSpinner: Ora;
}): Promise<void> => {
  const localConfig = FileManager.loadLocalPrompt(filePath);

  const currentVersion = lock.prompts[promptName]?.version;

  const configData = configDataFrom(localConfig);

  const syncResult = await promptsApiService.sync({
    name: promptName,
    configData,
    parameters: localConfig.parameters ?? {},
    localVersion: currentVersion,
    commitMessage: `Synced from local file: ${path.basename(filePath)}`,
  });

  const relativePath = path.relative(process.cwd(), filePath);

  let conflictResolution: "local" | "remote" | "abort" | null = null;
  if (syncResult.action === "conflict") {
    pushSpinner.stop();
    conflictResolution = await handleConflict(
      promptName,
      syncResult.conflictInfo!,
      forceResolution,
    );
    if (conflictResolution === "abort") {
      result.errors.push({
        name: promptName,
        error: "Push aborted due to conflict",
      });
      return;
    }

    if (conflictResolution === "remote" && syncResult.conflictInfo) {
      writeRemotePrompt({ filePath, conflictInfo: syncResult.conflictInfo });
    }

    pushSpinner.start();
  }

  await recordLockEntry({
    promptName,
    filePath,
    localConfig,
    syncResult,
    conflictResolution,
    lock,
    promptsApiService,
  });
  const actionText = recordAction({ promptName, syncResult, conflictResolution, result });

  pushSpinner.text = `${actionText} ${chalk.cyan(promptName)} ${chalk.gray(
    `(version ${
      syncResult.prompt?.version ?? syncResult.conflictInfo?.remoteVersion ?? "unknown"
    })`,
  )} ${conflictResolution === "remote" ? "to" : "from"} ${chalk.gray(relativePath)}`;
};

const warnAboutOrphanFiles = (config: PromptsConfig): void => {
  // Check for orphan local prompt files and show helpful warnings
  const discoveredLocalFiles = FileManager.getLocalPromptFiles();
  const orphanFiles = discoveredLocalFiles.filter((filePath) => {
    const promptName = FileManager.promptNameFromPath(filePath);
    return !config.prompts[promptName];
  });

  if (orphanFiles.length > 0) {
    console.log(
      chalk.yellow(
        `\n⚠ Found ${orphanFiles.length} orphan prompt file${orphanFiles.length > 1 ? "s" : ""}:`,
      ),
    );

    for (const filePath of orphanFiles) {
      const promptName = FileManager.promptNameFromPath(filePath);
      const relativePath = path.relative(process.cwd(), filePath);

      console.log(chalk.yellow(`  ${relativePath}`));
      console.log(chalk.gray(`    Add to prompts.json: "${promptName}": "file:${relativePath}"`));
    }

    console.log(chalk.gray(`\nTip: Add these to prompts.json to include them in push operations.`));
  }
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
  forceResolution,
}: {
  config: PromptsConfig;
  lock: PromptsLock;
  promptsApiService: PromptsApiService;
  result: SyncResult;
  forceResolution?: "local" | "remote";
}): Promise<void> => {
  const localFileRefs = Object.entries(config.prompts).filter(([, dependency]) => {
    return typeof dependency === "string" && dependency.startsWith("file:");
  });

  if (localFileRefs.length > 0) {
    const pushSpinner = createSpinner(`Pushing ${localFileRefs.length} local prompts...`).start();

    for (const [promptName, dependency] of localFileRefs) {
      try {
        const filePath = (dependency as string).slice(5); // Remove "file:" prefix
        await pushLocalPrompt({
          promptName,
          filePath,
          lock,
          promptsApiService,
          result,
          forceResolution,
          pushSpinner,
        });
      } catch (error) {
        const errorMessage = formatApiErrorMessage({ error });
        result.errors.push({ name: promptName, error: errorMessage });
      }
    }

    pushSpinner.stop();
  }

  warnAboutOrphanFiles(config);
};

const printPushResults = ({ result, duration }: { result: SyncResult; duration: string }): void => {
  if (result.pushed.length > 0) {
    for (const { name, version } of result.pushed) {
      const localPath = `./prompts/${name}.prompt.yaml`;
      console.log(
        chalk.green(
          `✓ Pushed ${chalk.cyan(name)} ${chalk.gray(
            `(version ${version})`,
          )} from ${chalk.gray(localPath)}`,
        ),
      );
    }
  }

  if (result.fetched.length > 0) {
    for (const { name, version } of result.fetched) {
      console.log(
        chalk.green(
          `✓ Pulled ${chalk.cyan(name)} ${chalk.gray(
            `(version ${version})`,
          )} (resolved conflict with remote)`,
        ),
      );
    }
  }

  if (result.errors.length > 0) {
    for (const { name, error } of result.errors) {
      console.error(chalk.red(`✗ Failed ${chalk.cyan(name)}: ${error}`));
    }
  }

  printPushSummary({ result, duration });
};

const printPushSummary = ({ result, duration }: { result: SyncResult; duration: string }): void => {
  const totalActions = result.fetched.length + result.pushed.length;

  if (totalActions === 0 && result.errors.length === 0) {
    console.log(chalk.gray(`Pushed in ${duration}s, no changes`));
    return;
  }

  const summary = [];
  if (result.pushed.length > 0) summary.push(`${result.pushed.length} pushed`);
  if (result.fetched.length > 0)
    summary.push(`${result.fetched.length} pulled (conflict resolution)`);
  if (result.errors.length > 0) summary.push(`${result.errors.length} errors`);

  console.log(chalk.gray(`Pushed ${summary.join(", ")} in ${duration}s`));
};

export const pushCommand = async (options?: {
  forceLocal?: boolean;
  forceRemote?: boolean;
}): Promise<void> => {
  console.log("⬆️  Pushing local prompts...");

  const startTime = Date.now();

  try {
    await resolveCredentials();

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

    let forceResolution: "local" | "remote" | undefined;
    if (options?.forceLocal) {
      forceResolution = "local";
    } else if (options?.forceRemote) {
      forceResolution = "remote";
    }

    await pushPrompts({
      config,
      lock,
      promptsApiService,
      result,
      forceResolution,
    });

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
      console.error(chalk.red(`Unexpected error: ${formatApiErrorMessage({ error })}`));
    }
    process.exit(1);
  }
};

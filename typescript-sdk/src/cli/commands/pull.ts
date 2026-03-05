import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { PromptConverter } from "@/cli/utils/promptConverter";
import {
  PromptsApiService,
  PromptsError,
} from "@/client-sdk/services/prompts";
import type { PromptsConfig, PromptsLock, SyncResult } from "../types";
import { FileManager } from "../utils/fileManager";
import { ensureProjectInitialized } from "../utils/init";
import { checkApiKey } from "../utils/apiKey";

/**
 * Core pull logic: fetches remote prompts and materializes them locally.
 * Returns the result and mutates the lock object in place.
 */
export const pullPrompts = async ({
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
  const remoteDeps = Object.entries(config.prompts).filter(
    ([, dependency]) => {
      if (typeof dependency === "object" && dependency.file) {
        return false;
      }
      if (typeof dependency === "string" && dependency.startsWith("file:")) {
        return false;
      }
      return true;
    }
  );

  if (remoteDeps.length > 0) {
    const fetchSpinner = ora(
      `Checking ${remoteDeps.length} remote prompts...`
    ).start();

    for (const [name, dependency] of remoteDeps) {
      try {
        const versionSpec =
          typeof dependency === "string"
            ? dependency
            : dependency.version ?? "latest";

        const lockEntry = lock.prompts[name];

        const prompt = await promptsApiService.get(name, { version: versionSpec });

        if (prompt) {
          const needsUpdate =
            lockEntry?.version !== prompt.version ||
            !lockEntry.materialized ||
            !fs.existsSync(path.resolve(lockEntry.materialized));

          if (needsUpdate) {
            const materializedPrompt =
              PromptConverter.fromApiToMaterialized(prompt);

            const savedPath = FileManager.saveMaterializedPrompt(
              name,
              materializedPrompt
            );
            const relativePath = path.relative(process.cwd(), savedPath);
            result.fetched.push({
              name,
              version: prompt.version,
              versionSpec,
            });

            FileManager.updateLockEntry(
              lock,
              name,
              materializedPrompt,
              savedPath
            );

            fetchSpinner.text = `Fetched ${chalk.cyan(
              `${name}@${versionSpec}`
            )} ${chalk.gray(`(version ${prompt.version})`)} → ${chalk.gray(
              relativePath
            )}`;
          } else {
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

  // Cleanup orphaned materialized files
  const currentDependencies = new Set(
    Object.keys(config.prompts).filter((name) => {
      const dependency = config.prompts[name];
      if (typeof dependency === "object" && dependency.file) {
        return false;
      }
      if (typeof dependency === "string" && dependency.startsWith("file:")) {
        return false;
      }
      return true;
    })
  );

  const cleanedFiles =
    FileManager.cleanupOrphanedMaterializedFiles(currentDependencies);
  if (cleanedFiles.length > 0) {
    result.cleaned = cleanedFiles;
    FileManager.removeFromLock(lock, cleanedFiles);
  }
};

const printPullResults = ({
  result,
  lock,
  duration,
}: {
  result: SyncResult;
  lock: PromptsLock;
  duration: string;
}): void => {
  if (result.fetched.length > 0) {
    for (const { name, version, versionSpec } of result.fetched) {
      const lockEntry = lock.prompts[name];
      const displayPath = lockEntry?.materialized
        ? `./${lockEntry.materialized}`
        : `./prompts/.materialized/${name}.prompt.yaml`;

      console.log(
        chalk.green(
          `✓ Pulled ${chalk.cyan(`${name}@${versionSpec}`)} ${chalk.gray(
            `(version ${version})`
          )} → ${chalk.gray(displayPath)}`
        )
      );
    }
  }

  if (result.cleaned.length > 0) {
    for (const name of result.cleaned) {
      console.log(
        chalk.yellow(
          `✓ Cleaned ${chalk.cyan(name)} (no longer in dependencies)`
        )
      );
    }
  }

  if (result.errors.length > 0) {
    for (const { name, error } of result.errors) {
      console.log(chalk.red(`✗ Failed ${chalk.cyan(name)}: ${error}`));
    }
  }

  const totalActions = result.fetched.length + result.cleaned.length;

  if (totalActions === 0 && result.errors.length === 0) {
    console.log(chalk.gray(`Pulled in ${duration}s, no changes`));
  } else {
    const summary = [];
    if (result.fetched.length > 0)
      summary.push(`${result.fetched.length} fetched`);
    if (result.cleaned.length > 0)
      summary.push(`${result.cleaned.length} cleaned`);
    if (result.errors.length > 0)
      summary.push(`${result.errors.length} errors`);

    console.log(chalk.gray(`Pulled ${summary.join(", ")} in ${duration}s`));
  }
};

export const pullCommand = async (): Promise<void> => {
  console.log("⬇️  Pulling remote prompts...");

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

    await pullPrompts({ config, lock, promptsApiService, result });

    FileManager.savePromptsLock(lock);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    printPullResults({ result, lock, duration });

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

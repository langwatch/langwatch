import chalk from "chalk";
import {
  PromptsApiService,
  PromptsError,
} from "@/client-sdk/services/prompts";
import type { SyncResult } from "../types";
import { FileManager } from "../utils/fileManager";
import { ensureProjectInitialized } from "../utils/init";
import { checkApiKey } from "../utils/apiKey";
import { pullPrompts } from "./pull";
import { pushPrompts } from "./push";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const syncCommand = async (): Promise<void> => {
  console.log("🔄 Starting sync...");

  const startTime = Date.now();

  try {
    // Check API key before doing anything else
    checkApiKey();

    // Get prompts API service
    const promptsApiService = new PromptsApiService();

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

    // Pull remote prompts (fetch and materialize)
    await pullPrompts({ config, lock, promptsApiService, result });

    // Push local prompts to API
    await pushPrompts({ config, lock, promptsApiService, result });

    // Save the updated lock file
    FileManager.savePromptsLock(lock);

    // Print individual results if there were actions
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

    // Print cleaned up files
    if (result.cleaned.length > 0) {
      for (const name of result.cleaned) {
        console.log(
          chalk.yellow(
            `✓ Cleaned ${chalk.cyan(name)} (no longer in dependencies)`
          )
        );
      }
    }

    // Print errors
    if (result.errors.length > 0) {
      for (const { name, error } of result.errors) {
        console.error(chalk.red(`✗ Failed ${chalk.cyan(name)}: ${error}`));
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
            formatApiErrorMessage({ error })
          }`
        )
      );
    }
    process.exit(1);
  }
};

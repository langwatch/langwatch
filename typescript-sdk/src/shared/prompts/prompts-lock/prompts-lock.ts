import * as fs from "fs";
import { MissingPromptLockError, PromptNotFoundError } from "./errors";

export interface LockEntry {
  version: number;
  versionId: string;
  materialized: string;
}

export interface PromptsLockConfig {
  lockFile?: string;
}

/**
 * Handles prompts-lock.json operations
 */
export class PromptsLock {
  private readonly lockFile: string;

  constructor(config: PromptsLockConfig = {}) {
    this.lockFile = config.lockFile ?? "prompts-lock.json";
  }

  /**
   * Initializes the lock file if it doesn't exist
   * Safe to run multiple times - preserves existing content
   */
  init(): void {
    if (!fs.existsSync(this.lockFile)) {
      const emptyLock = {
        lockfileVersion: 1,
        prompts: {}
      };
      fs.writeFileSync(this.lockFile, JSON.stringify(emptyLock, null, 2) + "\n");
    }
  }

  /**
   * Updates or creates an entry in the lock file
   */
  updateEntry(handle: string, entry: LockEntry): void {
    this.init();

    const lockContent = fs.readFileSync(this.lockFile, "utf-8");
    const lockData = JSON.parse(lockContent);

    lockData.prompts[handle] = entry;

    fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2) + "\n");
  }

  /**
   * Gets the materialized file path for a prompt handle from the lock file
   * Throws error if lock file or handle doesn't exist
   */
  getMaterializedPath(handle: string): string {
    try {
      const lockContent = fs.readFileSync(this.lockFile, "utf-8");
      const lockData = JSON.parse(lockContent);
      const entry = lockData.prompts?.[handle];

      if (!entry) {
        throw new PromptNotFoundError(handle);
      }

      return entry.materialized;
    } catch (error) {
      if (error instanceof PromptNotFoundError) {
        throw error; // Re-throw our custom error
      }
      // File doesn't exist or can't be parsed
      throw new MissingPromptLockError(this.lockFile);
    }
  }
}

import * as fs from "fs";
import * as path from "path";

export interface LockFile {
  prompts: Record<string, { version: number; [key: string]: any }>;
  [key: string]: any;
}

/**
 * Manages the prompts-lock.json lock file.
 *
 * Responsibilities:
 * - Read lock file
 * - Check lock file existence
 * - Provide access to prompt version information
 */
export class LockFileManager {
  private readonly lockPath: string;

  constructor(config: { cwd: string }) {
    this.lockPath = path.join(config.cwd, "prompts-lock.json");
  }

  /**
   * Checks if the lock file exists.
   * @returns True if the lock file exists
   */
  private lockFileExists(): boolean {
    return fs.existsSync(this.lockPath);
  }

  /**
   * Reads the prompts-lock.json file.
   * @returns Parsed lock file object, or null if not found
   */
  readLockFile(): LockFile | null {
    if (!this.lockFileExists()) throw new Error("Lock file not found");
    return JSON.parse(fs.readFileSync(this.lockPath, "utf8"));
  }
}

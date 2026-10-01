/**
 * The workspace `.env`, resolved from the repository root the way every application
 * resolves it. Node's loader leaves a variable that is already set alone, so the shell
 * still wins, and a worktree without the file is not an error.
 */
import { resolve } from "node:path";

export function loadWorkspaceEnv(): void {
  if (typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile(resolve(__dirname, "../../../../..", ".env"));
  } catch {
    // No workspace .env here; the shell is the whole environment.
  }
}

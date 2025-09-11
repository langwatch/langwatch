import path from "path";

export const PROJECT_ROOT = path.resolve(process.cwd());

export const PROMPTS_FILES = {
  CONFIG_FILE: "prompts.json",
  LOCK_FILE: "prompts-lock.json",
  PROMPTS_DIR: "prompts",
  MATERIALIZED_DIR: ".materialized",
} as const;

/**
 * Gets the prompts config file path for a project root.
 */
export function getPromptsConfigPath(): string {
  return path.join(PROJECT_ROOT, PROMPTS_FILES.CONFIG_FILE);
}

/**
 * Gets the prompts lock file path for a project root.
 */
export function getPromptsLockPath(): string {
  return path.join(PROJECT_ROOT, PROMPTS_FILES.LOCK_FILE);
}

/**
 * Gets the prompts directory path for a project root.
 */
export function getPromptsDir(): string {
  return path.join(PROJECT_ROOT, PROMPTS_FILES.PROMPTS_DIR);
}

/**
 * Gets the materialized prompts directory path for a project root.
 */
export function getMaterializedDir(): string {
  return path.join(getPromptsDir(), PROMPTS_FILES.MATERIALIZED_DIR);
}

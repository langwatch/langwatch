/**
 * Error thrown when prompts-lock.json file is not found
 */
export class MissingPromptLockError extends Error {
  constructor(lockFile = "prompts-lock.json") {
    super(`${lockFile} not found`);
    this.name = "MissingPromptLockError";
  }
}

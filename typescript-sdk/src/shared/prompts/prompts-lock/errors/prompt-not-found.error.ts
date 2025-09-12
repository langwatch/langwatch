/**
 * Error thrown when a prompt handle is not found in the lock file
 */
export class PromptNotFoundError extends Error {
  constructor(handle: string, source = "lock file") {
    super(`Prompt handle '${handle}' not found in ${source}`);
    this.name = "PromptNotFoundError";
  }
}

/**
 * Error class for template compilation issues
 */
export class PromptCompilationError extends Error {
  constructor(
    message: string,
    public readonly template: string,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = "PromptCompilationError";
  }
}

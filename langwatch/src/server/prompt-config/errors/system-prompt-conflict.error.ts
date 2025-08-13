export class SystemPromptConflictError extends Error {
  constructor(message?: string) {
    super(message ?? "System prompt and prompt cannot be set at the same time");
    this.name = "SystemPromptConflictError";
  }
}

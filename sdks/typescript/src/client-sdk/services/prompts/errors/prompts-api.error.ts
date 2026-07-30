import { PromptsError } from "./prompts.error";

/**
 * Error class for Prompts API operations.
 * Provides context about the failed operation and the original error.
 */
export class PromptsApiError extends PromptsError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "PromptsApiError";
  }
}

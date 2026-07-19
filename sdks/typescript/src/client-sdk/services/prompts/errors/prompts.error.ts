/**
 * Base error class for the Prompts domain.
 * All prompt-related errors should extend this class.
 */
export class PromptsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptsError";
  }
}

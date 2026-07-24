import { type z } from "zod";

/**
 * Error class for prompt validation issues
 */
export class PromptValidationError extends Error {
  constructor(message: string, public readonly validationErrors: z.ZodError) {
    super(message);
    this.name = "PromptValidationError";
  }
}

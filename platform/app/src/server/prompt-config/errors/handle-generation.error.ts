/**
 * Thrown when a unique handle could not be found for a duplicated or copied
 * prompt within the allowed number of attempts.
 */
export class HandleGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandleGenerationError";
  }
}

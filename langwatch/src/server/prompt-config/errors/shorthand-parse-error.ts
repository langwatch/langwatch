/**
 * Thrown when a prompt shorthand string fails to parse due to invalid format.
 * Maps to HTTP 422 Unprocessable Entity.
 */
export class ShorthandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShorthandParseError";
  }
}

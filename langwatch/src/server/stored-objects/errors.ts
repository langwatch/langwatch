/**
 * Error types for stored-object operations.
 */

/**
 * Thrown when a requested stored object does not exist at the given URI.
 */
export class ObjectNotFoundError extends Error {
  constructor(uri: string) {
    super(`Object not found: ${uri}`);
    this.name = "ObjectNotFoundError";
  }
}

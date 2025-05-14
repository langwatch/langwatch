/**
 * Error classes for SSE handling
 */

export class RetriableError extends Error {
  constructor(message = "Retriable error occurred") {
    super(message);
    this.name = "RetriableError";
  }
}

export class FatalError extends Error {
  constructor(message = "Fatal error occurred") {
    super(message);
    this.name = "FatalError";
  }
}

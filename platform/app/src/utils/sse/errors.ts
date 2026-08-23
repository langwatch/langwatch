/**
 * Error classes for SSE handling
 */

export class FetchSSETimeoutError extends Error {
  constructor(message = "Timeout occurred") {
    super(message);
    this.name = "Timeout";
  }
}

/**
 * The stream ended without reaching the terminator its protocol declares.
 *
 * Raised only for a caller that asked for `requireCompletion`. Distinct from a
 * timeout: the connection was not slow, it was cut, and whatever the caller
 * accumulated is a fragment rather than an answer.
 */
export class FetchSSEIncompleteStreamError extends Error {
  constructor(message = "The stream closed before the run completed") {
    super(message);
    this.name = "IncompleteStream";
  }
}

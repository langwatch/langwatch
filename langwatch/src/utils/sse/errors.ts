/**
 * Error classes for SSE handling
 */

export class FetchSSETimeoutError extends Error {
  constructor(message = "Timeout occurred") {
    super(message);
    this.name = "Timeout";
  }
}

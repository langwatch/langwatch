import { HandledError } from "@langwatch/handled-error";

/**
 * A count answered from a recent failure: a transient 503, so callers warn and retry. Fresh per
 * call, so its log line keeps its own trace. The store's error is a logged reason, never the body.
 */
export class RecentCountFailureError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor({ failure }: { failure: Error }) {
    super("service_unavailable", "The usage count failed moments ago; it is read again shortly.", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
      reasons: [failure],
    });
    this.name = "RecentCountFailureError";
  }
}

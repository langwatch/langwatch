/**
 * The subscription lane's own refusals. All three are the same claim from three angles:
 * the lane streams SUBSCRIPTIONS opened by this application's own pages, and nothing
 * else.
 */
import { HandledError } from "@langwatch/handled-error";

/** The composed router carries no procedure at the requested path. */
export class LiveStreamNotFoundError extends HandledError {
  declare readonly code: "live_stream_not_found";

  constructor() {
    super("live_stream_not_found", "No live update channel is served at that path.", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "LiveStreamNotFoundError";
  }
}

/**
 * The path names a real procedure, but a query or a mutation.
 */
export class LiveStreamUnsupportedProcedureError extends HandledError {
  declare readonly code: "live_stream_unsupported_procedure";

  constructor() {
    super(
      "live_stream_unsupported_procedure",
      "Only subscriptions are served on the live update channel; call this procedure over the tRPC endpoint instead.",
      { httpStatus: 405, fault: "customer" },
    );
    this.name = "LiveStreamUnsupportedProcedureError";
  }
}

/** The request did not originate from this application's own origin. */
export class LiveStreamCrossSiteBlockedError extends HandledError {
  declare readonly code: "live_stream_cross_site_blocked";

  constructor() {
    super(
      "live_stream_cross_site_blocked",
      "A live update channel can only be opened from this application's own pages.",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "LiveStreamCrossSiteBlockedError";
  }
}

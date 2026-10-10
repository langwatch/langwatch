import { HandledError } from "@langwatch/handled-error";

/** This deployment names no collector, so browser telemetry has nowhere to go. */
export class RumIngestDisabledError extends HandledError {
  declare readonly code: "rum_ingest_disabled";

  constructor() {
    super("rum_ingest_disabled", "Browser telemetry ingest is not configured", {
      httpStatus: 404,
      fault: "platform",
    });
    this.name = "RumIngestDisabledError";
  }
}

/** The report is over the byte cap or the span cap. */
export class RumPayloadTooLargeError extends HandledError {
  declare readonly code: "rum_payload_too_large";

  constructor(message = "Payload too large") {
    super("rum_payload_too_large", message, { httpStatus: 413, fault: "customer" });
    this.name = "RumPayloadTooLargeError";
  }
}

/** The report is not an OTLP/JSON trace export this door can walk. */
export class RumPayloadInvalidError extends HandledError {
  declare readonly code: "rum_payload_invalid";

  constructor() {
    super("rum_payload_invalid", "Malformed payload", { httpStatus: 400, fault: "customer" });
    this.name = "RumPayloadInvalidError";
  }
}

/** The caller's bucket, or the whole door's, is spent for this minute. */
export class RumRateLimitedError extends HandledError {
  declare readonly code: "rum_rate_limited";

  constructor() {
    super("rum_rate_limited", "Too many telemetry reports", {
      httpStatus: 429,
      fault: "customer",
    });
    this.name = "RumRateLimitedError";
  }
}

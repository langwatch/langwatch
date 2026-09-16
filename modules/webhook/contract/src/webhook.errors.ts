import { HandledError } from "@langwatch/handled-error";

/**
 * The refusal's machine name. Held as a constant because the gate is composed
 * by the process and read by both doors, so the two ends recognise it by code
 * rather than by class identity across a package boundary.
 */
export const WEBHOOK_ENDPOINTS_NOT_ENTITLED_CODE = "webhook_endpoints_not_entitled";

export const WEBHOOK_ENDPOINTS_ENTITLEMENT_MESSAGE =
  "Webhook endpoints are an enterprise feature; this organization's plan does not include them.";

export class WebhookEndpointsNotEntitledError extends HandledError {
  declare readonly code: "webhook_endpoints_not_entitled";

  constructor() {
    super(WEBHOOK_ENDPOINTS_NOT_ENTITLED_CODE, WEBHOOK_ENDPOINTS_ENTITLEMENT_MESSAGE, {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "WebhookEndpointsNotEntitledError";
  }
}

export class WebhookEndpointValidationError extends HandledError {
  declare readonly code: "webhook_endpoint_invalid";

  constructor(message: string) {
    super("webhook_endpoint_invalid", message, { httpStatus: 400, fault: "customer" });
    this.name = "WebhookEndpointValidationError";
  }
}

export class WebhookEndpointNotFoundError extends HandledError {
  declare readonly code: "webhook_endpoint_not_found";

  constructor() {
    super("webhook_endpoint_not_found", "Webhook endpoint not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "WebhookEndpointNotFoundError";
  }
}

export class WebhookEventNotFoundError extends HandledError {
  declare readonly code: "webhook_event_not_found";

  constructor() {
    super("webhook_event_not_found", "That event is not in this organization's log", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "WebhookEventNotFoundError";
  }
}

/**
 * The test-delivery door answered this organization too often. `fault` stays
 * customer: the test fires are theirs, and the retry-after is theirs to wait
 * out — a test flood would leave LangWatch egress IPs toward a third party.
 */
export class WebhookTestRateLimitedError extends HandledError {
  declare readonly code: "webhook_test_rate_limited";

  constructor(input: { retryAfterSeconds?: number | undefined }) {
    super("webhook_test_rate_limited", "Too many webhook test deliveries in the last minute", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
      ...(input.retryAfterSeconds !== undefined
        ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
        : {}),
    });
    this.name = "WebhookTestRateLimitedError";
  }
}

/**
 * A named refusal for the one collaborator a process may compose no builder
 * for: a stable code, a customer-safe message, `fault: "platform"`.
 */
export class WebhookDispatchUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This process cannot send a webhook test delivery; delivery runs on a different process here.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "WebhookDispatchUnavailableError";
  }
}

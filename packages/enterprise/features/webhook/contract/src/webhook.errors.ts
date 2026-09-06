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

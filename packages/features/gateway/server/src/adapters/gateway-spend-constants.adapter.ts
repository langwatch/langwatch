export const GATEWAY_SPEND_PIPELINE_NAME = "gateway_spend_processing" as const;
export const GATEWAY_SPEND_AGGREGATE_TYPE = "gateway_request" as const;

export const ADMIT_SPEND_COMMAND_TYPE = "lw.gateway_request.admit_spend" as const;
export const CONFIRM_SPEND_COMMAND_TYPE = "lw.gateway_request.confirm_spend" as const;
export const FAIL_SPEND_COMMAND_TYPE = "lw.gateway_request.fail_spend" as const;
export const SETTLE_SPEND_COMMAND_TYPE = "lw.gateway_request.settle_spend" as const;

export const GATEWAY_SPEND_PROCESSING_COMMAND_TYPES = [
  ADMIT_SPEND_COMMAND_TYPE,
  CONFIRM_SPEND_COMMAND_TYPE,
  FAIL_SPEND_COMMAND_TYPE,
  SETTLE_SPEND_COMMAND_TYPE,
] as const;

export const GATEWAY_SPEND_ADMITTED_EVENT_TYPE = "lw.gateway.spend.admitted" as const;
export const GATEWAY_SPEND_CONFIRMED_EVENT_TYPE = "lw.gateway.spend.confirmed" as const;
export const GATEWAY_SPEND_FAILED_EVENT_TYPE = "lw.gateway.spend.failed" as const;
export const GATEWAY_SPEND_SETTLED_EVENT_TYPE = "lw.gateway.spend.settled" as const;

export const GATEWAY_SPEND_PROCESSING_EVENT_TYPES = [
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
] as const;

export const GATEWAY_SPEND_EVENT_VERSION_LATEST = "2026-07-29" as const;

/**
 * Schema-snapshot version of the gatewaySpend fold (calendar date). The
 * projected row stamps it; the store's read-back only trusts rows carrying
 * the current stamp, so a row written by an older shape refolds once from
 * the event log instead of decoding column defaults into wrong state.
 */
export const GATEWAY_SPEND_PROJECTION_VERSION_LATEST = "2026-07-29";

export { BLOCKED_CLOUD_DOMAINS, BLOCKED_METADATA_HOSTS } from "./ssrf/blocked-hosts";
export {
  createSsrfUrlValidator,
  isBlockedCloudDomain,
  isPrivateOrLocalhostIP,
} from "./ssrf/url-validator";
export type {
  SsrfAllowlistedResult,
  SsrfPolicy,
  SsrfResolvedResult,
  SsrfUnresolvedResult,
  SsrfUrlValidator,
  SsrfValidationResult,
} from "./ssrf/url-validator";
export { fetchValidatedDestination, RedirectRefusedError } from "./ssrf/fenced-fetch";
export type { EgressTlsPolicy, FencedFetchOptions } from "./ssrf/fenced-fetch";

export { WebhookDispatchRateLimiterPort } from "./ports/webhook-dispatch-rate-limiter.port";
export type { WebhookDispatchRateLimitResult } from "./ports/webhook-dispatch-rate-limiter.port";
export { InMemoryWebhookDispatchRateLimiterAdapter } from "./adapters/in-memory.webhook-dispatch-rate-limiter.adapter";

export {
  assertWebhookDelivered,
  classifyWebhookStatus,
  WEBHOOK_DELIVERY_ATTEMPT_HEADER,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_TEST_FIRE_HEADER,
} from "./webhook/delivery-classification";
export type { WebhookSendResult } from "./webhook/delivery-classification";
export {
  assertDispatchBudget,
  WEBHOOK_DISPATCH_HOURLY_CAP,
  WEBHOOK_DISPATCH_WINDOW_SECONDS,
  webhookDispatchBudgetKey,
} from "./webhook/dispatch-budget";
export { sendHttpDestination } from "./webhook/http-destination";
export type { HttpDestinationRequest, HttpDestinationResponse } from "./webhook/http-destination";
export {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "./webhook/signature";
export {
  assertWebhookUrlAllowed,
  inspectWebhookUrl,
  webhookUrlValidator,
} from "./webhook/url-policy";

export { WebhookEgressService } from "./services/webhook-egress.service";
export type { WebhookSendInput } from "./services/webhook-egress.service";

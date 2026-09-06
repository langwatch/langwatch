export { BLOCKED_CLOUD_DOMAINS, BLOCKED_METADATA_HOSTS } from "./ssrf/blocked-hosts.ts";
export {
  createSsrfUrlValidator,
  isBlockedCloudDomain,
  isPrivateOrLocalhostIP,
} from "./ssrf/url-validator.ts";
export type {
  SsrfAllowlistedResult,
  SsrfPolicy,
  SsrfResolvedResult,
  SsrfUnresolvedResult,
  SsrfUrlValidator,
  SsrfValidationResult,
} from "./ssrf/url-validator.ts";
export { fetchValidatedDestination, RedirectRefusedError } from "./ssrf/fenced-fetch.ts";
export type { EgressTlsPolicy, FencedFetchOptions } from "./ssrf/fenced-fetch.ts";

export { WebhookDispatchRateLimiterPort } from "./ports/webhook-dispatch-rate-limiter.port.ts";
export type { WebhookDispatchRateLimitResult } from "./ports/webhook-dispatch-rate-limiter.port.ts";
export { InMemoryWebhookDispatchRateLimiterAdapter } from "./adapters/in-memory.webhook-dispatch-rate-limiter.adapter.ts";

export {
  assertWebhookDelivered,
  classifyWebhookStatus,
  WEBHOOK_DELIVERY_ATTEMPT_HEADER,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_TEST_FIRE_HEADER,
} from "./webhook/delivery-classification.ts";
export type { WebhookSendResult } from "./webhook/delivery-classification.ts";
export {
  assertDispatchBudget,
  WEBHOOK_DISPATCH_HOURLY_CAP,
  WEBHOOK_DISPATCH_WINDOW_SECONDS,
  webhookDispatchBudgetKey,
} from "./webhook/dispatch-budget.ts";
export { sendHttpDestination } from "./webhook/http-destination.ts";
export type { HttpDestinationRequest, HttpDestinationResponse } from "./webhook/http-destination.ts";
export {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "./webhook/signature.ts";
export { buildVectors, serializeVectors, VECTORS_RELATIVE_PATH } from "./webhook/signature-vectors.ts";
export type {
  SignatureVectorFile,
  SigningVector,
  VectorOutcome,
  VerificationVector,
} from "./webhook/signature-vectors.ts";
export {
  assertWebhookUrlAllowed,
  inspectWebhookUrl,
  webhookUrlValidator,
} from "./webhook/url-policy.ts";

export { WebhookEgressService } from "./services/webhook-egress.service.ts";
export type { WebhookSendInput } from "./services/webhook-egress.service.ts";

export { WebhookSignatureVectorsTask } from "./tasks/webhook-signature-vectors.task.ts";

/**
 * The corporate proxy a self-hosted deployment's outbound vendor calls leave
 * through.
 *
 * Here rather than in the platform application because it IS the egress fence's
 * other half: the SSRF policy decides which addresses we may reach, and this
 * decides how we reach them. Every caller that talks HTTPS to a vendor — the
 * mail gateways, the AWS clients — resolves it the same way, and a second copy
 * of the `no_proxy` matching is how one transport starts bypassing a proxy the
 * others honour.
 */
export {
  configureProcessOutboundProxy,
  getProcessOutboundProxyConfig,
  hostnameOf,
  isProxyBypassed,
  parseOutboundProxyConfig,
  resolveProxyForHost,
  type OutboundProxyConfig,
} from "./proxy/outbound-proxy.ts";

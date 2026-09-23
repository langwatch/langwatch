export {
  WEBHOOK_ENDPOINTS_ENTITLEMENT_MESSAGE,
  WEBHOOK_EVENT_TYPES,
  WebhookEndpointNotFoundError,
  WebhookEndpointValidationError,
  WebhookEndpointsNotEntitledError,
  WebhookEventNotFoundError,
  eventMatches,
  isValidEventSelector,
  type SqsCredentialMode,
  type SqsDestinationInput,
  type SqsDestinationView,
  type WebhookDeliveryControls,
  type WebhookDeliveryOutcome,
  type WebhookDestinationKind,
  type WebhookEndpointHealth,
  type WebhookEndpointView,
  type WebhookEnvelope,
  type WebhookEventType,
  type WebhookEventTypeName,
} from "@langwatch/webhook-contract";
export type { WebhookEndpointDeps } from "./repositories/prisma/prisma.webhook-endpoint.repository.ts";
export type {
  WebhookEndpointRuntime,
  WebhookEndpointServiceOptions,
  WebhookEndpointStatusSnapshot,
} from "./repositories/webhook-endpoint.repository.ts";
export type { WebhookId, WebhookSecret } from "./app/webhook.app.ts";
// Webhook event reads are composed through the repository and held as the
// port. Its cursor codec is private to the feature: nothing outside it
// names that any more.
export type { WebhookClickHouseClientResolver } from "./repositories/clickhouse/clickhouse.webhook-events.repository.ts";
export { webhookRepositories } from "./repositories/webhook-repositories.registry.ts";
export type { WebhookRepositories } from "./repositories/webhook.repositories.ts";
export type { WebhookEndpointConfigurationInput } from "./services/webhook-endpoint-policy.service.ts";
export type {
  ParsedSqsQueueUrl,
  WebhookDestinationConfig,
  WebhookUrlProblemCode,
} from "./services/webhook-destination.service.ts";
export {
  WebhookDeliveryService,
  type WebhookDeliveryProcessDeps,
} from "./services/webhook-delivery.service.ts";
export {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  WEBHOOK_SEND_MAX_ATTEMPTS,
} from "./rules/webhook-delivery-contract.rules.ts";
export type {
  AdmitSpendCommandData,
  ConfirmSpendCommandData,
  DeliverPayload,
  EndpointStreamState,
  FailSpendCommandData,
  FlushEndpointPayload,
  GatewaySpendProcessingEvent,
  SendBatchPayload,
  SettleSpendCommandData,
  SpendAttribution,
  SpendUsage,
  WebhookDeliveryEndpointService,
  WebhookDeliveryState,
} from "./rules/webhook-delivery-contract.rules.ts";
export type { PendingEnvelope } from "./services/webhook-batch-planner.service.ts";
export {
  WebhookEnvelopeService,
  type WebhookSpendEventRow,
  type WebhookSpendEventStatus,
} from "./services/webhook-envelope.service.ts";
export type {
  WebhookEventsService,
  LegacyWebhookEventsServiceOptions,
  WebhookProjectReader,
  WebhookEventsServiceOptions,
} from "./services/webhook-events.service.ts";
export type {
  WebhookEndpointHealthSource,
  WebhookHealthDeps,
} from "./services/webhook-health.service.ts";

/**
 * The feature's application: the one object both of its doors call. The process composes it
 * from the endpoint store, the health report, the emitted-events log, the entitlement check,
 * the delivery hop a test fire uses, and the `Idempotency-Key` ledger.
 */
export {
  WebhookApp,
  type WebhookAppDependencies,
  type WebhookTestDispatch,
} from "./app/webhook.app.ts";

/**
 * How another package composes this feature: the envelope a spend row is
 * rendered through.
 */
export {
  webhookServer,
  createWebhookEnvelopes,
  type WebhookEnvelopes,
  type WebhookLiveDatabase,
} from "./webhook.server.ts";

/**
 * The session-authenticated tRPC namespace this feature owns, `webhookEndpoints`.
 */
export { webhookEndpointTrpcTransport } from "./transport/webhook-endpoint.trpc.ts";

/**
 * The organization-key REST family this feature owns, `/api/webhooks/v1`.
 */
export { webhookRest } from "./transport/webhook.rest.ts";

// --------------------------------------------------------------------------- An endpoint's
// LAST HOP Everything above the destination interface is one machinery no matter where an
// endpoint delivers — the same coalescing buffer, the same retry ladder, the same delivery log,
// the same signature over the same bytes. Only the hop differs, and it differs behind
// `WebhookDestination`.
export type {
  WebhookDestination,
  WebhookDispatchRequest,
  WebhookDispatchResult,
  WebhookDispatchVerdict,
} from "./app/webhook.app.ts";
export {
  WebhookDestinationAdapter,
  type WebhookDestinationDeps,
} from "./services/webhook-destination-dispatch.service.ts";
export { HttpWebhookDestinationAdapter } from "./services/http.webhook-destination.service.ts";
export type {
  AwsClientConfigResolver,
  SqsDestinationConfig,
} from "./services/sqs.webhook-destination.service.ts";
export { SqsWebhookDestinationChannel } from "./channels/sqs/sqs.webhook-destination.channel.ts";
export type { SqsWebhookSender } from "./channels/webhook-destination.channel.ts";
export type { SqsQueueUrlInspection, SqsQueueUrlProblem } from "./rules/sqs-queue-url.rules.ts";

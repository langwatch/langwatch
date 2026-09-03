export { PostgresAutomationAdapter } from "./adapters/postgres.automation.adapter";
export { PostgresAutomationGraphDeliveryAdapter } from "./adapters/postgres.automation-graph-delivery.adapter";
export { SlackWebhookDeliveryAdapter } from "./adapters/slack-webhook.delivery.adapter";
export type {
  RenderedSlackMessageRequest,
  SlackWebhookRequest,
  SlackWebhookTransport,
} from "./adapters/slack-webhook.delivery.adapter";
export { SlackProviderAdapter } from "./adapters/slack-provider.adapter";
export type { AutomationSecretCrypto } from "./adapters/slack-provider.adapter";
export {
  WebhookProviderAdapter,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
} from "./adapters/webhook-provider.adapter";
export type {
  AutomationWebhookSecretCrypto,
  WebhookStoredActionParams,
} from "./adapters/webhook-provider.adapter";
export { WebhookDeliveryAdapter } from "./adapters/webhook-delivery.adapter";
export { AutomationProviderRegistryAdapter } from "./adapters/registry.automation-provider.adapter";
export type {
  PersistActionParamsArgs,
  ServerDef,
  ServerEntry,
} from "./adapters/registry.automation-provider.adapter";
export { AutomationPersistActionService } from "./services/persist-action.service";
export {
  AutomationDatasetMapperPort,
  AutomationPersistActionWriterPort,
} from "./ports/automation-persist-action.port";
export {
  computeScheduledFor,
  NOTIFY_TRIGGER_ACTIONS,
  PERSIST_TRIGGER_ACTIONS,
} from "@langwatch/automation-contract";
export type {
  WebhookDeliveryRecorder,
  WebhookDeliveryRequest,
  WebhookDeliveryTransport,
  WebhookSendResult,
} from "./adapters/webhook-delivery.adapter";
export { SlackWebApiDeliveryAdapter } from "./adapters/slack-web-api.delivery.adapter";
export type {
  SlackApiTransport,
  SlackChannel,
  SlackChannelListGap,
  SlackChannelListing,
} from "./adapters/slack-web-api.delivery.adapter";
export {
  createAutomationsPipeline,
  RecordTriggerMatchCommand,
} from "./adapters/eventing.automation.adapter";
export {
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  TRIGGER_MATCH_COALESCE_MAX_BATCH,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
} from "@langwatch/automation-contract";
export type {
  AutomationEvent,
  AutomationsPipelineDeps,
  TriggerMatchRecordedEvent,
} from "./adapters/eventing.automation.adapter";
export { TriggerSettlement } from "./processes/trigger-settlement.process";
export {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  createGraphTriggerActivityHandler,
  graphTriggerActivityGroupKey,
} from "./subscribers/graph-trigger-activity.subscriber";
export { AutomationEvaluationSubscriberService } from "./services/automation-evaluation-subscriber.service";
export { AutomationEvaluationTriggerFilterService } from "./services/automation-evaluation-trigger-filter.service";
export {
  AutomationEvaluationQueryClassificationPort,
  AutomationEvaluationTraceSummaryPort,
  AutomationEvaluationTriggerFilterPort,
  AutomationTriggerMatchRecorderPort,
} from "./ports/automation-evaluation-subscriber.port";
export type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "./intents/trigger-settlement.intent";
export { TRIGGER_SETTLEMENT_INTENT_TYPES } from "./intents/trigger-settlement.intent";
export type { SettlementState } from "./processes/trigger-settlement.process";
export { GRAPH_ALERT_SWEEP_INTERVAL_MS } from "./processes/graph-alert-sweep.process";
export {
  AutomationEmailCapService,
  type ConsumeDailyEmailCapInput,
  type ConsumeHourlyEmailCapInput,
} from "./services/email-cap.service";
export { AutomationPersistCapService } from "./services/persist-cap.service";
export type {
  ConsumePersistCapSlotInput,
  PersistCapConfig,
  PersistCapDecision,
  PersistCapDependencies,
  ReadPersistCapCountsInput,
  AutomationPersistCapRedisPort,
} from "./services/persist-cap.service";
export { AutomationEmailCapStorePort } from "./ports/email-cap.port";
export {
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationHeartbeatPort,
  AutomationSlackBotTokenDecryptorPort,
  AutomationDispatchErrorPort,
} from "./ports/automation-graph.port";
export type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "./ports/automation-graph.port";
export { AutomationGraphDeliveryPort } from "./ports/automation-graph-delivery.port";
export { AutomationRunawayPort, type ClaimLease } from "./ports/automation-runaway.port";
/**
 * The containment POLICY behind that port.
 *
 * Published because the decision — is this automation misconfigured, has this
 * organization already been told today, may this process be the one to pause
 * it — belongs to the feature, and the only thing a composition root supplies
 * is the infrastructure the port names. A root that wrote the policy itself
 * would be free to pause on a different rule than the one the spec pins.
 */
export {
  CONTAINMENT_CHECK_CLAIM_SECONDS,
  PAUSE_ATTEMPT_CLAIM_SECONDS,
  RUNAWAY_MIN_PROJECT_TRACES,
  RUNAWAY_TRAFFIC_SHARE,
  RunawayContainmentService,
} from "./services/runaway-containment.service";
export { AutomationNotificationDeliveryPort } from "./ports/automation-notification-delivery.port";
export {
  AutomationSlackProviderPort,
  AutomationWebhookProviderPort,
  type AutomationWebhookStoredParams,
} from "./ports/automation-provider.port";
export {
  AutomationSettlementFilterEvaluatorPort,
  AutomationSettlementMatchConfirmationPort,
  AutomationSettlementExecutorPort,
  AutomationSettlementObservabilityPort,
} from "./ports/automation-settlement.port";
export { AutomationSettlementLedgerPort } from "./ports/automation-settlement-ledger.port";
export {
  AutomationSettlementEvaluationReaderPort,
  AutomationSettlementTraceReaderPort,
  AutomationTraceRecordUnavailableError,
} from "./ports/automation-settlement-read.port";
export {
  AutomationSettlementBreachPort,
  PostgresAutomationSettlementLedgerAdapter,
  type AutomationSettlementLedgerDatabase,
  type AutomationSettlementPersistCap,
} from "./adapters/postgres.automation-settlement-ledger.adapter";
export { AutomationSettlementDispatchService } from "./services/trigger-settlement-dispatch.service";
export {
  GraphTriggerHeartbeatService,
  type GraphTriggerHeartbeatDeps,
} from "./services/graph-trigger-heartbeat.service";
export { PrismaTriggerRepository } from "./repositories/prisma/prisma.trigger.repository";
export { PrismaGraphTriggerSentRepository } from "./repositories/prisma/prisma.graph-trigger-sent.repository";
export { PrismaWebhookDeliveryRepository } from "./repositories/prisma/prisma.webhook-delivery.repository";
export { AutomationSettlementMatchConfirmationService } from "./services/automation-settlement-match-confirmation.service";
export { GraphAlertDispatchService } from "./services/graph-alert-dispatch.service";
export { AutomationClockPort } from "./ports/automation-clock.port";
export {
  AutomationGraphActivityPort,
  AutomationProjectIdentityPort,
} from "./ports/automation-graph-activity.port";
export {
  PostgresAutomationGraphActivityAdapter,
  type AutomationGraphActivityDatabase,
} from "./adapters/postgres.automation-graph-activity.adapter";
export { AutomationTraceTriggerCataloguePort } from "./ports/automation-trace-trigger-catalogue.port";
export {
  PostgresAutomationTraceTriggerCatalogueAdapter,
  type AutomationTraceTriggerCatalogueDatabase,
} from "./adapters/postgres.automation-trace-trigger-catalogue.adapter";
export { HmacUnsubscribeTokenAdapter } from "./adapters/hmac.unsubscribe-token.adapter";
export { ActiveTriggerCacheService } from "./services/active-trigger-cache.service";
export { UnsubscribeTokenService } from "./services/unsubscribe-token.service";
export {
  TEST_FIRE_TRIGGER_ID_SENTINEL,
  TriggerNoReplyService,
  TriggerNoReplyWarningPort,
} from "./services/trigger-no-reply.service";
export { AutomationIntentRetentionPort } from "./ports/automation-intent-retention.port";
export { AutomationScheduledIntentPort } from "./ports/automation-scheduled-intent.port";
export {
  AutomationTestFirePort,
  type TestFireEmail,
  type TestFireSlackBot,
  type TestFireSlackWebhook,
  type TestFireWebhook,
} from "./ports/automation-test-fire.port";
export { SchedulerWakePort } from "./ports/scheduler-wake.port";
export {
  UnsubscribeTokenVerifierPort,
  type UnsubscribeTokenPayload,
} from "./ports/unsubscribe-token.port";
export { ScheduledJobStorePort, type ScheduledJobRecord } from "./ports/scheduled-jobs.port";
export {
  AutomationTrpcApi,
  type AutomationTrpcContext,
  type AutomationTrpcPorts,
} from "./transport/api-trpc/automation.api";
export {
  EmailSuppressionTrpcApi,
  type EmailSuppressionTrpcContext,
  type EmailSuppressionTrpcPorts,
} from "./transport/api-trpc/email-suppression.api";
export { buildRetryAfterMessage } from "./transport/api-trpc/retry-after-message";

/**
 * The feature's application: the one object all three of its doors call, and
 * the refusals it names. The process composes it from the services below.
 */
export {
  AutomationApp,
  AutomationFiltersUnsupportedError,
  AutomationNotInProjectError,
  AutomationTraceFilterInvalidError,
  AutomationWebhookNotEnabledError,
  AutomationWebhookUpsertRequiredError,
  GraphAlertChannelUnsupportedError,
  GraphAlertSeverityRequiredError,
  GraphAlertThresholdRequiredError,
  GraphNotInProjectError,
  ReportChannelUnsupportedError,
  ReportScheduleMissingError,
  TestFireRateLimitedError,
  UnsubscribeLinkInvalidError,
  UnsubscribeRateLimitedError,
  type AutomationAppDependencies,
  type AutomationProjectIdentity,
} from "./app/automation.app";

/**
 * The app-process REST family this feature owns. The process supplies the
 * bound REST security service, a resolver for the application and its own
 * platform-URL builder; the base path, access declarations, schemas and
 * delegation are the feature's.
 */
export { createTriggerRestApp } from "./transport/api-rest/automation.api";
export { createSlackTriggerRestApp } from "./transport/api-rest/slack-trigger.api";
// The RFC 8058 one-click unsubscribe door. Its own family rather than part of
// the trigger surface: the HMAC token IS the authorization, so it authenticates
// nobody and shares no policy with the credentialed routes beside it.
export {
  createUnsubscribeRestApp,
  type UnsubscribeRestPorts,
} from "./transport/api-rest/unsubscribe.api";

/** The scheduled-report handler and the two readers it renders from. */
export {
  dispatchScheduledReport,
  reportWindowMs,
  type ReportDispatchDeps,
  type ReportProject,
} from "./services/report-dispatch.service";
export {
  loadReportCharts,
  REPORT_CHART_QUERY_CONCURRENCY,
  type ReportChartDeps,
  type ReportGraphInput,
} from "./services/report-chart.service";
export { toReportTraceRow } from "./services/report-trace-row.service";
export {
  AUTOMATION_AUTO_PAUSED_METRIC_NAME,
  AUTOMATION_CEILING_BREACH_METRIC_NAME,
  AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME,
  AutomationRunawayMetricsSink,
  NoopAutomationRunawayMetrics,
  OtelAutomationRunawayMetricsAdapter,
} from "./adapters/otel.automation-runaway-metrics.adapter";
export {
  AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME,
  OtelAutomationSettlementObservabilityAdapter,
} from "./adapters/otel.automation-settlement-observability.adapter";

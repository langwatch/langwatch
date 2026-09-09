export {
  PostgresAutomationAdapter,
  type AutomationDatabase,
} from "./adapters/postgres.automation.adapter.ts";
export { automationServer } from "./automation.server.ts";
export { PostgresAutomationGraphDeliveryAdapter } from "./adapters/postgres.automation-graph-delivery.adapter.ts";
export { SlackWebhookDeliveryAdapter } from "./adapters/slack-webhook.delivery.adapter.ts";
export type {
  RenderedSlackMessageRequest,
  SlackWebhookRequest,
  SlackWebhookTransport,
} from "./adapters/slack-webhook.delivery.adapter.ts";
export { SlackWebhookClientAdapter } from "./adapters/slack-webhook.client.adapter.ts";
export { SlackProviderAdapter } from "./adapters/slack-provider.adapter.ts";
export type { AutomationSecretCrypto } from "./adapters/slack-provider.adapter.ts";
export {
  WebhookProviderAdapter,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
} from "./adapters/webhook-provider.adapter.ts";
export type {
  AutomationWebhookSecretCrypto,
  WebhookStoredActionParams,
} from "./adapters/webhook-provider.adapter.ts";
export { WebhookDeliveryAdapter } from "./adapters/webhook-delivery.adapter.ts";
export { AutomationProviderRegistryAdapter } from "./adapters/registry.automation-provider.adapter.ts";
export type {
  PersistActionParamsArgs,
  ServerDef,
  ServerEntry,
} from "./adapters/registry.automation-provider.adapter.ts";
export { AutomationPersistActionService } from "./services/persist-action.service.ts";
export {
  AutomationDatasetMapperPort,
  AutomationPersistActionWriterPort,
} from "./ports/automation-persist-action.port.ts";
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
} from "./adapters/webhook-delivery.adapter.ts";
export { SlackWebApiDeliveryAdapter } from "./adapters/slack-web-api.delivery.adapter.ts";
export type { SlackApiTransport } from "./adapters/slack-web-api.delivery.adapter.ts";
export {
  createAutomationsPipeline,
  RecordTriggerMatchCommand,
} from "./adapters/eventing.automation.adapter.ts";
export {
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  TRIGGER_MATCH_COALESCE_MAX_BATCH,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
} from "@langwatch/automation-contract";
export type {
  AutomationEvent,
  AutomationsPipelineDeps,
  TriggerMatchRecordedEvent,
} from "./adapters/eventing.automation.adapter.ts";
export { TriggerSettlement } from "./processes/trigger-settlement.process.ts";
export {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  createGraphTriggerActivityHandler,
  graphTriggerActivityGroupKey,
} from "./subscribers/graph-trigger-activity.subscriber.ts";
export { AutomationEvaluationSubscriberService } from "./services/automation-evaluation-subscriber.service.ts";
export { AutomationEvaluationTriggerFilterService } from "./services/automation-evaluation-trigger-filter.service.ts";
export {
  AutomationEvaluationQueryClassificationPort,
  AutomationEvaluationTraceSummaryPort,
  AutomationEvaluationTriggerFilterPort,
  AutomationTriggerMatchRecorderPort,
} from "./ports/automation-evaluation-subscriber.port.ts";
export type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "./intents/trigger-settlement.intent.ts";
export { TRIGGER_SETTLEMENT_INTENT_TYPES } from "./intents/trigger-settlement.intent.ts";
export type { SettlementState } from "./processes/trigger-settlement.process.ts";
export { GRAPH_ALERT_SWEEP_INTERVAL_MS } from "./processes/graph-alert-sweep.process.ts";
export {
  AutomationEmailCapService,
  type ConsumeDailyEmailCapInput,
  type ConsumeHourlyEmailCapInput,
} from "./services/email-cap.service.ts";
export { AutomationPersistCapService } from "./services/persist-cap.service.ts";
export type {
  ConsumePersistCapSlotInput,
  PersistCapConfig,
  PersistCapDecision,
  PersistCapDependencies,
  ReadPersistCapCountsInput,
  AutomationPersistCapRedisPort,
} from "./services/persist-cap.service.ts";
export { AutomationEmailCapStorePort } from "./ports/email-cap.port.ts";
export {
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationHeartbeatPort,
  AutomationSlackBotTokenDecryptorPort,
  AutomationDispatchErrorPort,
} from "./ports/automation-graph.port.ts";
export type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "./ports/automation-graph.port.ts";
export { AutomationGraphDeliveryPort } from "./ports/automation-graph-delivery.port.ts";
export { AutomationRunawayPort, type ClaimLease } from "./ports/automation-runaway.port.ts";
/**
 * The containment POLICY behind that port.
 */
export {
  CONTAINMENT_CHECK_CLAIM_SECONDS,
  PAUSE_ATTEMPT_CLAIM_SECONDS,
  RUNAWAY_MIN_PROJECT_TRACES,
  RUNAWAY_TRAFFIC_SHARE,
  RunawayContainmentService,
} from "./services/runaway-containment.service.ts";
export { AutomationNotificationDeliveryPort } from "./ports/automation-notification-delivery.port.ts";
export {
  AutomationSlackProviderPort,
  AutomationWebhookProviderPort,
  type AutomationWebhookStoredParams,
} from "./ports/automation-provider.port.ts";
export {
  AutomationSettlementFilterEvaluatorPort,
  AutomationSettlementMatchConfirmationPort,
  AutomationSettlementExecutorPort,
  AutomationSettlementObservabilityPort,
} from "./ports/automation-settlement.port.ts";
export { AutomationSettlementLedgerPort } from "./ports/automation-settlement-ledger.port.ts";
export {
  AutomationSettlementEvaluationReaderPort,
  AutomationSettlementTraceReaderPort,
  AutomationTraceRecordUnavailableError,
} from "./ports/automation-settlement-read.port.ts";
export {
  AutomationSettlementBreachPort,
  PostgresAutomationSettlementLedgerAdapter,
  type AutomationSettlementLedgerDatabase,
  type AutomationSettlementPersistCap,
} from "./adapters/postgres.automation-settlement-ledger.adapter.ts";
export { AutomationSettlementDispatchService } from "./services/trigger-settlement-dispatch.service.ts";
export {
  GraphTriggerHeartbeatService,
  type GraphTriggerHeartbeatDeps,
} from "./services/graph-trigger-heartbeat.service.ts";
export { PrismaTriggerRepository } from "./repositories/prisma/prisma.trigger.repository.ts";
export { PrismaGraphTriggerSentRepository } from "./repositories/prisma/prisma.graph-trigger-sent.repository.ts";
export { PrismaWebhookDeliveryRepository } from "./repositories/prisma/prisma.webhook-delivery.repository.ts";
export { AutomationSettlementMatchConfirmationService } from "./services/automation-settlement-match-confirmation.service.ts";
export { GraphAlertDispatchService } from "./services/graph-alert-dispatch.service.ts";
export { AutomationClockPort } from "./ports/automation-clock.port.ts";
export {
  AutomationGraphActivityPort,
  AutomationProjectIdentityPort,
} from "./ports/automation-graph-activity.port.ts";
export {
  PostgresAutomationGraphActivityAdapter,
  type AutomationGraphActivityDatabase,
} from "./adapters/postgres.automation-graph-activity.adapter.ts";
export { AutomationTraceTriggerCataloguePort } from "./ports/automation-trace-trigger-catalogue.port.ts";
export {
  PostgresAutomationTraceTriggerCatalogueAdapter,
  type AutomationTraceTriggerCatalogueDatabase,
} from "./adapters/postgres.automation-trace-trigger-catalogue.adapter.ts";
export { HmacUnsubscribeTokenAdapter } from "./adapters/hmac.unsubscribe-token.adapter.ts";
export { ActiveTriggerCacheService } from "./services/active-trigger-cache.service.ts";
export { UnsubscribeTokenService } from "./services/unsubscribe-token.service.ts";
export {
  TEST_FIRE_TRIGGER_ID_SENTINEL,
  TriggerNoReplyService,
  TriggerNoReplyWarningPort,
} from "./services/trigger-no-reply.service.ts";
export { AutomationIntentRetentionPort } from "./ports/automation-intent-retention.port.ts";
export { AutomationScheduledIntentPort } from "./ports/automation-scheduled-intent.port.ts";
export {
  AutomationTestFirePort,
  type TestFireEmail,
  type TestFireSlackBot,
  type TestFireSlackWebhook,
  type TestFireWebhook,
} from "./ports/automation-test-fire.port.ts";
export { SchedulerWakePort } from "./ports/scheduler-wake.port.ts";
export {
  UnsubscribeTokenVerifierPort,
  type UnsubscribeTokenPayload,
} from "./ports/unsubscribe-token.port.ts";
export { ScheduledJobStorePort, type ScheduledJobRecord } from "./ports/scheduled-jobs.port.ts";
export { buildRetryAfterMessage } from "./rules/retry-after-message.rules.ts";

/**
 * The feature's application: the one object all five of its doors call, and the
 * technical infrastructure a process supplies it with. Its refusals are the
 * contract's, beside every other error this feature names.
 */
export {
  AutomationApp,
  type AutomationActionParamsParse,
  type AutomationActionParamsSchema,
  type AutomationAuditSink,
  type AutomationCallCounter,
  type AutomationProjectIdentity,
  type AutomationProviderSecrets,
  type AutomationSlackDirectory,
  type AutomationTraceFilterCompiler,
} from "./app/automation.app.ts";

/**
 * The declared transports a process mounts. `/api/triggers` is a factory because
 * its rows carry a platform URL only the mounting process can build; the other
 * four are inert declarations, carried by `automationServer` too.
 */
export { createAutomationRest } from "./transport/automation.rest.ts";
export {
  slackAutomationRest,
  slackAutomationRestErrors,
} from "./transport/slack-trigger.rest.ts";
export {
  unsubscribeCallerAddress,
  unsubscribeRest,
  unsubscribeRestErrors,
} from "./transport/unsubscribe.rest.ts";
export { automationCallerEmailFact, automationTrpcTransport } from "./transport/automation.trpc.ts";
export { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";

/** The scheduled-report handler and the two readers it renders from. */
export {
  ReportDispatchService,
  type ReportDispatchDeps,
  type ReportProject,
} from "./services/report-dispatch.service.ts";
export {
  ReportChartService,
  REPORT_CHART_QUERY_CONCURRENCY,
  type ReportChartDeps,
} from "./services/report-chart.service.ts";
export type { ReportGraphInput } from "./rules/report-chart.rules.ts";
export { ReportTraceRowService } from "./services/report-trace-row.service.ts";
/**
 * The two Postgres reads a scheduled report fires through, published so a background process
 * can compose the handler over its own client.
 */
export { PrismaTriggerFireHistoryRepository } from "./repositories/prisma/prisma.trigger-fire-history.repository.ts";
export { PrismaCustomGraphRepository } from "./repositories/prisma/prisma.custom-graph.repository.ts";
export { ReportScheduleService } from "./services/report-schedule.service.ts";
export {
  AUTOMATION_AUTO_PAUSED_METRIC_NAME,
  AUTOMATION_CEILING_BREACH_METRIC_NAME,
  AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME,
  AutomationRunawayMetricsSink,
  NoopAutomationRunawayMetrics,
  OtelAutomationRunawayMetricsAdapter,
} from "./adapters/otel.automation-runaway-metrics.adapter.ts";
export {
  AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME,
  OtelAutomationSettlementObservabilityAdapter,
} from "./adapters/otel.automation-settlement-observability.adapter.ts";

export { SlackAlertTask } from "./tasks/slack-alert.task.ts";

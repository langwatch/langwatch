export {
  PostgresAutomationRepositories,
  type AutomationDatabase,
} from "./repositories/prisma/prisma.automation.repositories.ts";
export { automationRepositories } from "./repositories/automation-repositories.registry.ts";
export type { AutomationRepositories } from "./repositories/automation.repositories.ts";
export { automationServer } from "./automation.server.ts";
export { PrismaAutomationGraphDeliveryRepository as PostgresAutomationGraphDeliveryAdapter } from "./repositories/prisma/prisma.automation-graph-delivery.repository.ts";
export { SlackWebhookDeliveryAdapter } from "./channels/slack/slack.webhook-delivery.channel.ts";
export type {
  RenderedSlackMessageRequest,
  SlackWebhookRequest,
  SlackWebhookTransport,
} from "./channels/slack/slack.webhook-delivery.channel.ts";
export { SlackWebhookClientAdapter } from "./channels/slack/slack.webhook-client.channel.ts";
export {
  AutomationSlackProvider,
  AutomationSlackSecretsService,
  AutomationSlackBotTokenDecryptorService,
} from "./services/automation-slack-secrets.service.ts";
export type { AutomationSecretCrypto } from "./services/automation-slack-secrets.service.ts";
export {
  AutomationWebhookProvider,
  AutomationWebhookSecretsService,
  WEBHOOK_PREVIOUS_SECRET_TTL_MS,
} from "./services/automation-webhook-secrets.service.ts";
export type {
  AutomationWebhookSecretCrypto,
  AutomationWebhookStoredParams,
  WebhookStoredActionParams,
} from "./services/automation-webhook-secrets.service.ts";
export { WebhookDeliveryAdapter } from "./channels/http/http.webhook-delivery.channel.ts";
export { AutomationProviderRegistryService } from "./services/automation-provider-registry.service.ts";
export type {
  PersistActionParamsArgs,
  ServerDef,
  ServerEntry,
} from "./services/automation-provider-registry.service.ts";
export { AutomationPersistActionService } from "./services/persist-action.service.ts";
export { AutomationDatasetMapper } from "./services/automation-dataset-mapper.service.ts";
export { AutomationPersistActionWriter } from "./repositories/automation-persist-action.repository.ts";
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
} from "./channels/http/http.webhook-delivery.channel.ts";
export { SlackWebApiDeliveryAdapter } from "./channels/slack/slack.web-api-delivery.channel.ts";
export type { SlackApiTransport } from "./channels/slack/slack.web-api-delivery.channel.ts";
export {
  createAutomationsPipeline,
  RecordTriggerMatchCommand,
} from "./eventing/automation.pipeline.ts";
export {
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  TRIGGER_MATCH_COALESCE_MAX_BATCH,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
} from "@langwatch/automation-contract";
export type {
  AutomationEvent,
  AutomationsPipelineDeps,
  TriggerMatchRecordedEvent,
} from "./eventing/automation.pipeline.ts";
export { TriggerSettlement } from "./processes/trigger-settlement.process.ts";
export {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  createGraphTriggerActivityHandler,
  graphTriggerActivityGroupKey,
} from "./subscribers/graph-trigger-activity.subscriber.ts";
export { AutomationEvaluationSubscriberService } from "./services/automation-evaluation-subscriber.service.ts";
export { AutomationEvaluationTriggerFilterService } from "./services/automation-evaluation-trigger-filter.service.ts";
export type {
  AutomationEvaluationQueryClassification as AutomationEvaluationQueryClassification,
  AutomationEvaluationTraceSummary as AutomationEvaluationTraceSummary,
  AutomationEvaluationTriggerFilter as AutomationEvaluationTriggerFilter,
  AutomationTriggerMatchRecorder as AutomationTriggerMatchRecorder,
} from "./app/automation.infrastructure.ts";
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
  AutomationPersistCapRedis,
} from "./services/persist-cap.service.ts";
export { AutomationEmailCapRepository } from "./repositories/automation-email-cap.repository.ts";
export {
  AutomationGraphNotifier,
} from "./channels/automation-graph-alert.channel.ts";
export type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "./channels/automation-graph-alert.channel.ts";
export {
  AutomationLogger,
  AutomationHeartbeat,
  AutomationDispatchError,
} from "./services/automation-graph-runtime.service.ts";
export { AutomationSlackBotTokenDecryptor } from "./services/automation-slack-secrets.service.ts";
export type { AutomationGraphDelivery as AutomationGraphDelivery } from "./app/automation.infrastructure.ts";
export { AutomationRunaway, type ClaimLease } from "./repositories/automation-runaway.repository.ts";
export { AutomationRunawayNotice } from "./channels/automation-runaway-notice.channel.ts";
export { AutomationRunawaySignals } from "./services/automation-runaway-signals.service.ts";
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
export { AutomationNotificationDelivery } from "./channels/automation-notification-delivery.channel.ts";
export {
  AutomationSettlementFilterEvaluator,
  AutomationSettlementMatchConfirmation,
} from "./services/automation-settlement-policy.service.ts";
export { AutomationSettlementExecutor } from "./services/automation-settlement-executor.service.ts";
export {
  AutomationSettlementObservability,
  AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME,
  OtelAutomationSettlementObservabilityAdapter,
} from "./services/automation-settlement-observability.service.ts";
export { AutomationSettlementLedger } from "./repositories/automation-settlement-ledger.repository.ts";
export {
  AutomationSettlementEvaluationReader,
  AutomationSettlementTraceReader,
  AutomationTraceRecordUnavailableError,
} from "./repositories/automation-settlement-read.repository.ts";
export {
  AutomationSettlementBreach,
  type AutomationSettlementPersistCap,
} from "./repositories/automation-settlement-ledger.repository.ts";
export {
  PrismaAutomationSettlementLedgerRepository,
  type AutomationSettlementLedgerDatabase,
} from "./repositories/prisma/prisma.automation-settlement-ledger.repository.ts";
export { AutomationSettlementDispatchService } from "./services/trigger-settlement-dispatch.service.ts";
export {
  GraphTriggerHeartbeatService,
  type GraphTriggerHeartbeatDeps,
} from "./services/graph-trigger-heartbeat.service.ts";
export {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "./repositories/prisma/prisma.trigger.repository.ts";
export {
  PrismaGraphTriggerSentRepository,
  type GraphTriggerSentDatabase,
} from "./repositories/prisma/prisma.graph-trigger-sent.repository.ts";
export {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "./repositories/prisma/prisma.webhook-delivery.repository.ts";
export {
  PrismaEmailSuppressionRepository,
  type EmailSuppressionDatabase,
} from "./repositories/prisma/prisma.email-suppression.repository.ts";
export {
  AutomationGraphActivityService,
} from "./services/automation-graph-activity.service.ts";
export {
  AutomationGraphDeliveryService,
} from "./services/automation-graph-delivery.service.ts";
export {
  AutomationSettlementLedgerService,
} from "./services/automation-settlement-ledger.service.ts";
export {
  AutomationTraceTriggerCatalogueService,
} from "./services/automation-trace-trigger-catalogue.service.ts";
export { AutomationSettlementMatchConfirmationService } from "./services/automation-settlement-match-confirmation.service.ts";
export { GraphAlertDispatchService } from "./services/graph-alert-dispatch.service.ts";
export type { AutomationClock as AutomationClock } from "./app/automation.infrastructure.ts";
export type {
  AutomationGraphActivity as AutomationGraphActivity,
  AutomationProjectIdentityPort,
} from "./app/automation.infrastructure.ts";
export {
  PrismaAutomationGraphActivityRepository as PostgresAutomationGraphActivityAdapter,
  type AutomationGraphActivityDatabase,
} from "./repositories/prisma/prisma.automation-graph-activity.repository.ts";
export { AutomationTraceTriggerCatalogue } from "./repositories/automation-trace-trigger-catalogue.repository.ts";
export {
  PrismaAutomationTraceTriggerCatalogueRepository,
  type AutomationTraceTriggerCatalogueDatabase,
} from "./repositories/prisma/prisma.automation-trace-trigger-catalogue.repository.ts";
export { ActiveTriggerCacheService } from "./services/active-trigger-cache.service.ts";
export {
  HmacUnsubscribeTokenAdapter,
  UnsubscribeTokenService,
  UnsubscribeTokenVerifier,
  type UnsubscribeTokenPayload,
} from "./services/unsubscribe-token.service.ts";
export {
  TEST_FIRE_TRIGGER_ID_SENTINEL,
  TriggerNoReplyService,
  TriggerNoReplyWarning,
} from "./services/trigger-no-reply.service.ts";
export { AutomationIntentRetention } from "./repositories/automation-intent-retention.repository.ts";
export { AutomationScheduledIntent } from "./services/automation-scheduled-intent.service.ts";
export {
  AutomationTestFire,
  type TestFireEmail,
  type TestFireSlackBot,
  type TestFireSlackWebhook,
  type TestFireWebhook,
} from "./channels/automation-test-fire.channel.ts";
export { SchedulerWake } from "./channels/automation-scheduler-wake.channel.ts";
export { AutomationScheduledJobRepository, type ScheduledJobRecord } from "./repositories/automation-scheduled-job.repository.ts";
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
export {
  PrismaCustomGraphRepository,
  type CustomGraphDatabase,
} from "./repositories/prisma/prisma.custom-graph.repository.ts";
export { ReportScheduleService } from "./services/report-schedule.service.ts";
export {
  AUTOMATION_AUTO_PAUSED_METRIC_NAME,
  AUTOMATION_CEILING_BREACH_METRIC_NAME,
  AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME,
  AutomationRunawayMetricsSink,
  NoopAutomationRunawayMetrics,
  OtelAutomationRunawayMetricsAdapter,
} from "./services/automation-runaway-metrics.service.ts";

export { SlackAlertTask } from "./tasks/slack-alert.task.ts";

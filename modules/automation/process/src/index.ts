export type { AutomationDatabase } from "./repositories/prisma/prisma.automation.repositories.ts";
export type { AutomationRepositories } from "./repositories/automation.repositories.ts";
export { automationServer } from "./automation.server.ts";
export {
  createAutomationCustomGraphs,
  createAutomationGraphTriggerSent,
  createAutomationSettlementLedger,
  createAutomationTraceTriggerCatalogue,
  createAutomationTriggers,
  createAutomationWebhookDeliveries,
} from "./automation.server.ts";
export { PostgresAutomationGraphDeliveryAdapter } from "./repositories/prisma/prisma.automation-graph-delivery.repository.ts";
export { SlackWebhookDeliveryChannel } from "./channels/slack/slack.webhook-delivery.channel.ts";
export type {
  RenderedSlackMessageRequest,
  SlackWebhookRequest,
  SlackWebhookTransport,
} from "./channels/slack/slack.webhook-delivery.channel.ts";
export { SlackWebhookClientChannel } from "./channels/slack/slack.webhook-client.channel.ts";
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
export { HttpWebhookDeliveryChannel } from "./channels/http/http.webhook-delivery.channel.ts";
export { AutomationProviderRegistryService } from "./services/automation-provider-registry.service.ts";
export type {
  PersistActionParamsArgs,
  ServerDef,
  ServerEntry,
} from "./services/automation-provider-registry.service.ts";
export { AutomationPersistActionService } from "./services/persist-action.service.ts";
export { AutomationDatasetMapper } from "./app/automation.members.ts";
export { AutomationPersistActionRepository } from "./repositories/automation-persist-action.repository.ts";
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
export { SlackWebApiDeliveryChannel } from "./channels/slack/slack.web-api-delivery.channel.ts";
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
export { TriggerSettlement } from "./eventing/trigger-settlement.process.ts";
export { createGraphTriggerActivityHandler } from "./eventing/graph-trigger-activity.subscriber.ts";
export { AutomationEvaluationSubscriberService } from "./services/automation-evaluation-subscriber.service.ts";
export { AutomationEvaluationTriggerFilterService } from "./services/automation-evaluation-trigger-filter.service.ts";
export type {
  AutomationEvaluationQueryClassification,
  AutomationEvaluationTraceSummary,
  AutomationEvaluationTriggerFilter,
  AutomationTriggerMatchRecorder,
} from "./app/automation.members.ts";
export type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "./eventing/trigger-settlement.intent.ts";
export { TRIGGER_SETTLEMENT_INTENT_TYPES } from "./eventing/trigger-settlement.intent.ts";
export type { SettlementState } from "./eventing/trigger-settlement.process.ts";
export { GRAPH_ALERT_SWEEP_INTERVAL_MS } from "./eventing/graph-alert-sweep.process.ts";
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
} from "./services/persist-cap.service.ts";
export { AutomationEmailCapRepository } from "./repositories/automation-email-cap.repository.ts";
export type { AutomationPersistCapRepository } from "./repositories/automation-persist-cap.repository.ts";
export { AutomationGraphNotifier } from "./channels/automation-graph-alert.channel.ts";
export type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "./channels/automation-graph-alert.channel.ts";
export {
  AutomationLogger,
  AutomationHeartbeat,
  AutomationDispatchError,
} from "./app/automation.members.ts";
export { AutomationSlackBotTokenDecryptor } from "./services/automation-slack-secrets.service.ts";
export type { AutomationGraphDelivery } from "./app/automation.members.ts";
export {
  AutomationRunawayRepository,
  type ClaimLease,
} from "./repositories/automation-runaway.repository.ts";
export { AutomationRunawayNotice } from "./channels/automation-runaway-notice.channel.ts";
export { AutomationRunawaySignals } from "./app/automation.members.ts";
export {
  AutomationRunawayService,
  type AutomationRunawayDirectories,
  type RunawayClickHouseResolver,
  type AutomationRunawaySuppression,
  type AutomationNextStepResolver,
} from "./services/automation-runaway.service.ts";
export {
  AutomationNextStepService,
  AutomationOrganizationPricing,
} from "./services/automation-next-step.service.ts";
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
export { AutomationNotificationDeliveryService } from "./services/automation-notification-delivery.service.ts";
export type { AutomationSettlementMatchConfirmation } from "./services/automation-settlement-match-confirmation.service.ts";
export { AutomationSettlementExecutor } from "./app/automation.members.ts";
export {
  AutomationSettlementObservability,
  AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME,
  AutomationSettlementObservabilityService,
} from "./services/automation-settlement-observability.service.ts";
export { AutomationSettlementLedgerRepository } from "./repositories/automation-settlement-ledger.repository.ts";
export {
  AutomationSettlementEvaluationRepository,
  AutomationSettlementTraceRepository,
  AutomationTraceRecordUnavailableError,
} from "./repositories/automation-settlement-read.repository.ts";
export {
  AutomationSettlementBreach,
  type AutomationSettlementPersistCap,
} from "./repositories/automation-settlement-ledger.repository.ts";
export { type AutomationSettlementLedgerDatabase } from "./repositories/prisma/prisma.automation-settlement-ledger.repository.ts";
export { AutomationSettlementDispatchService } from "./services/trigger-settlement-dispatch.service.ts";
export {
  GraphTriggerHeartbeatService,
  type GraphTriggerHeartbeatDeps,
} from "./services/graph-trigger-heartbeat.service.ts";
export { type TriggerDatabase } from "./repositories/prisma/prisma.trigger.repository.ts";
export { type GraphTriggerSentDatabase } from "./repositories/prisma/prisma.graph-trigger-sent.repository.ts";
export { type WebhookDeliveryDatabase } from "./repositories/prisma/prisma.webhook-delivery.repository.ts";
export type { EmailSuppressionDatabase } from "./repositories/prisma/prisma.email-suppression.repository.ts";
export { AutomationSettlementMatchConfirmationService } from "./services/automation-settlement-match-confirmation.service.ts";
export type { AutomationClock } from "./app/automation.members.ts";
export type {
  AutomationGraphActivity,
  AutomationProjectDirectory,
} from "./app/automation.members.ts";
export {
  PostgresAutomationGraphActivityAdapter,
  type AutomationGraphActivityDatabase,
} from "./repositories/prisma/prisma.automation-graph-activity.repository.ts";
export { AutomationTraceTriggerCatalogueRepository } from "./repositories/automation-trace-trigger-catalogue.repository.ts";
export { type AutomationTraceTriggerCatalogueDatabase } from "./repositories/prisma/prisma.automation-trace-trigger-catalogue.repository.ts";
export type { UnsubscribeTokenPayload } from "./services/unsubscribe-token.service.ts";
export { TEST_FIRE_TRIGGER_ID_SENTINEL } from "./channels/automation-test-fire.channel.ts";
export { UnsubscribeTokenService } from "./services/unsubscribe-token.service.ts";
export {
  TriggerNoReplyService,
  TriggerNoReplyWarning,
} from "./services/trigger-no-reply.service.ts";
export { AutomationIntentRetentionRepository } from "./repositories/automation-intent-retention.repository.ts";
export { AutomationScheduledIntent } from "./app/automation.members.ts";
export {
  AutomationTestFire,
  type TestFireEmail,
  type TestFireSlackBot,
  type TestFireSlackWebhook,
  type TestFireWebhook,
} from "./channels/automation-test-fire.channel.ts";
export { SchedulerWake } from "./channels/automation-scheduler-wake.channel.ts";
export {
  AutomationScheduledJobRepository,
  type ScheduledJobRecord,
} from "./repositories/automation-scheduled-job.repository.ts";

/**
 * The feature's application: the one object all five of its doors call, and the
 * technical members a process supplies it with. Its refusals are the
 * contract's, beside every other error this feature names.
 */
export type {
  AutomationActionParamsParse,
  AutomationActionParamsSchema,
  AutomationAuditSink,
  AutomationCallCounter,
  AutomationProjectIdentity,
  AutomationProviderSecrets,
  AutomationSlackDirectory,
  AutomationTraceFilterCompiler,
} from "./app/automation.app.ts";

/**
 * The declared transports a process mounts. `/api/triggers` is a factory because
 * its rows carry a platform URL only the mounting process can build; the other
 * four are inert declarations, carried by `automationServer` too.
 */
export { createAutomationRest } from "./transport/automation.rest.ts";
export { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
export { unsubscribeCallerAddress, unsubscribeRest } from "./transport/unsubscribe.rest.ts";
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
export { toReportTraceRow } from "./rules/report-trace-row.rules.ts";
/**
 * The two Postgres reads a scheduled report fires through, published so a background process
 * can compose the handler over its own client.
 */
export { PrismaTriggerFireHistoryRepository } from "./repositories/prisma/prisma.trigger-fire-history.repository.ts";
export { type CustomGraphDatabase } from "./repositories/prisma/prisma.custom-graph.repository.ts";
export { ReportScheduleService } from "./services/report-schedule.service.ts";
export {
  AUTOMATION_AUTO_PAUSED_METRIC_NAME,
  AUTOMATION_CEILING_BREACH_METRIC_NAME,
  AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME,
  AutomationRunawayMetricsOtelService,
} from "./services/automation-runaway-metrics-otel.service.ts";
export { AutomationRunawayMetricsNullService } from "./services/automation-runaway-metrics-null.service.ts";
export { AutomationRunawayMetricsSink } from "./app/automation.members.ts";

/**
 * What a process composes this feature through. Each takes the substrates the
 * process owns and returns the contribution behind the ports it already names;
 * which class does the work, and which table it reads, stay in here.
 */
export {
  createAutomationEmailCaps,
  createAutomationEvaluationSubscriber,
  createAutomationGraphActivity,
  createAutomationMailEnvelope,
  createAutomationReportCalendar,
  createAutomationSettlement,
  type AutomationMailEnvelope,
  type AutomationPersistCeiling,
  type AutomationReportCalendar,
  type AutomationReportCalendarDatabase,
  type AutomationRunawayCollaborator,
  type AutomationSettlement,
  type AutomationSettlementDatabase,
} from "./automation.server.ts";
/** The ledger a late-built containment collaborator filters its notice through. */
export type { AutomationSettlementLedgerService } from "./services/automation-settlement-ledger.service.ts";

export { SlackAlertTask } from "./tasks/slack-alert.task.ts";

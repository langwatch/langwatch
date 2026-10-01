export type { AutomationDatabase } from "./repositories/prisma/prisma.automation.repositories.ts";
export type { AutomationRepositories } from "./repositories/automation.repositories.ts";
export { automationProcessModule } from "./automation.module.ts";
export {
  createAutomationCustomGraphs,
  createAutomationGraphTriggerSent,
  createAutomationTraceTriggerCatalogue,
  createAutomationTriggers,
} from "./automation.module.ts";
export { SlackWebhookDeliveryChannel } from "./channels/slack/slack.webhook-delivery.channel.ts";
export type {
  RenderedSlackMessageRequest,
  SlackWebhookRequest,
  SlackWebhookTransport,
} from "./channels/slack/slack.webhook-delivery.channel.ts";
export { SlackWebhookClientChannel } from "./channels/slack/slack.webhook-client.channel.ts";
export type { AutomationSecretCrypto } from "./services/automation-slack-secrets.service.ts";
export type {
  AutomationWebhookSecretCrypto,
  AutomationWebhookStoredParams,
  WebhookStoredActionParams,
} from "./services/automation-webhook-secrets.service.ts";
export { HttpWebhookDeliveryChannel } from "./channels/http/http.webhook-delivery.channel.ts";
export type {
  PersistActionParamsArgs,
  ServerDef,
  ServerEntry,
} from "./services/automation-provider-registry.service.ts";
export {
  computeScheduledFor,
  NOTIFY_TRIGGER_ACTIONS,
  PERSIST_TRIGGER_ACTIONS,
} from "@langwatch/automation-contract";
export type {
  WebhookDeliveryRequest,
  WebhookDeliveryTransport,
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
export { createGraphTriggerActivityHandler } from "./eventing/graph-trigger-activity.subscriber.ts";
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
export type {
  ConsumePersistCapSlotInput,
  PersistCapConfig,
  PersistCapDecision,
  PersistCapDependencies,
  ReadPersistCapCountsInput,
} from "./services/persist-cap.service.ts";
export type { AutomationPersistCapRepository } from "./repositories/automation-persist-cap.repository.ts";
export { AutomationGraphNotifier } from "./channels/automation-graph-alert.channel.ts";
export type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "./channels/automation-graph-alert.channel.ts";
export type { AutomationGraphDelivery } from "./app/automation.members.ts";
export { AutomationRunawayNotice } from "./channels/automation-runaway-notice.channel.ts";
export { AutomationNotificationDelivery } from "./channels/automation-notification-delivery.channel.ts";
export type { AutomationSettlementMatchConfirmation } from "./services/automation-settlement-match-confirmation.service.ts";
export type { EmailSuppressionDatabase } from "./repositories/prisma/prisma.email-suppression.repository.ts";
export type { AutomationClock } from "./app/automation.members.ts";
export type {
  AutomationGraphActivity,
  AutomationProjectDirectory,
} from "./app/automation.members.ts";
export type { UnsubscribeTokenPayload } from "./services/unsubscribe-token.service.ts";
export { TEST_FIRE_TRIGGER_ID_SENTINEL } from "./channels/automation-test-fire.channel.ts";
export {
  AutomationTestFire,
  type TestFireEmail,
  type TestFireSlackBot,
  type TestFireSlackWebhook,
  type TestFireWebhook,
} from "./channels/automation-test-fire.channel.ts";

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
 * four are inert declarations, carried by `automationProcessModule` too.
 */
export { createAutomationRest } from "./transport/automation.rest.ts";
export { slackAutomationRest } from "./transport/slack-trigger.rest.ts";
export { unsubscribeCallerAddress, unsubscribeRest } from "./transport/unsubscribe.rest.ts";
export { automationCallerEmailFact, automationTrpcTransport } from "./transport/automation.trpc.ts";
export { emailSuppressionTrpcTransport } from "./transport/email-suppression.trpc.ts";

/** The ledger a late-built containment collaborator filters its notice through. */
export type { AutomationSettlementLedgerService } from "./services/automation-settlement-ledger.service.ts";

export { SlackAlertTask } from "./tasks/slack-alert.task.ts";

import type { SuppressEmailCommand } from "./automation.commands";
import type { EmailSuppression } from "./automation";
import type { CustomGraph, CustomGraphNameRef } from "./custom-graph";
import type { WebhookDeliveryInput, WebhookDeliveryRow } from "./webhook-delivery";
import type { Trigger } from "./trigger";
import type { CreateTriggerCommand, UpdateTriggerCommand } from "./trigger.commands";
import type {
  ReportSchedule,
  TriggerFire,
  TriggerFireStats,
  TriggerSummary,
} from "./trigger.queries";
import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
} from "./graph-alert";
import type { AutomationPersistCapBreach } from "./runaway";
import type { TestFireInput, TestFireResult, TestFireTemplateDraft } from "./test-fire";
export abstract class AutomationService {
  abstract validateTemplateDraft(input: TestFireTemplateDraft): void;
  abstract testFire(input: TestFireInput): Promise<TestFireResult>;
  abstract evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;
  abstract decideGraphTriggerHeartbeat(input: {
    now: Date;
  }): Promise<GraphTriggerSweepCandidate[]>;
  abstract handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void>;
  abstract getById(input: { triggerId: string; projectId: string }): Promise<Trigger>;
  abstract tryGetById(input: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null>;
  abstract getAllForProject(input: { projectId: string }): Promise<Trigger[]>;
  abstract create(input: CreateTriggerCommand): Promise<Trigger>;
  abstract update(input: UpdateTriggerCommand): Promise<Trigger>;
  abstract archive(input: { triggerId: string; projectId: string }): Promise<Trigger>;
  abstract softDeleteById(input: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger>;
  abstract tryGetByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null>;
  abstract getByCustomGraphIds(input: {
    projectId: string;
    customGraphIds: string[];
  }): Promise<Trigger[]>;
  abstract getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]>;
  abstract getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]>;
  abstract claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract filterSendClaimed(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>>;
  abstract updateLastRunAt(input: {
    triggerId: string;
    projectId: string;
  }): Promise<void>;
  abstract invalidate(projectId: string): Promise<void>;
  abstract getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]>;
  abstract syncReportSchedule(input: {
    projectId: string;
    triggerId: string;
    cron: string;
    timezone: string;
  }): Promise<void>;
  abstract removeReportSchedule(input: {
    projectId: string;
    triggerId: string;
  }): Promise<void>;
  /**
   * Repairs report triggers whose durable scheduler row was not persisted
   * alongside the trigger. Existing paused rows must remain untouched.
   */
  abstract reconcileReportSchedules(): Promise<{ repaired: number }>;
  abstract getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]>;
  abstract getRecentFires(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]>;
  abstract recordFire(input: {
    projectId: string;
    triggerId: string;
    traceId?: string | null;
    customGraphId?: string | null;
    createdAt: Date;
    resolvedAt?: Date | null;
  }): Promise<TriggerFire>;
  abstract getSuppressions(input: { projectId: string }): Promise<EmailSuppression[]>;
  abstract getAllEnriched(input: {
    projectId: string;
  }): Promise<Array<EmailSuppression & { triggerName: string | null }>>;
  abstract suppressEmail(input: SuppressEmailCommand): Promise<EmailSuppression>;
  abstract removeSuppression(input: { id: string; projectId: string }): Promise<void>;
  abstract filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
  abstract tryResolveUnsubscribeView(input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null>;
  abstract confirmUnsubscribe(input: {
    token: string;
    scope: "trigger" | "project";
  }): Promise<void>;
  abstract tryGetCustomGraph(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null>;
  abstract customGraphExistsInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean>;
  abstract getCustomGraphNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]>;
  abstract recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void>;
  abstract getRecentWebhookDeliveries(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]>;
  abstract pruneWebhookDeliveries(now?: Date): Promise<number>;
}

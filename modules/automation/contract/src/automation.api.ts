import { moduleApi } from "@langwatch/kernel/module-api";
import type { Monitor } from "@langwatch/monitor-contract";
import type { Instant } from "@langwatch/time";

import type {
  AutomationEvaluationActivityContext,
  AutomationEvaluationSubscriberContext,
  AutomationEvaluationSubscriberEvent,
} from "./automation-evaluation-subscriber.service.ts";
import type {
  AutomationListRow,
  AutomationPersistCapStatus,
  SlackChannelListing,
} from "./automation.responses.ts";
import type {
  AutomationApiCreateInput,
  AutomationApiListSlackChannelsInput,
  AutomationApiTestFireInput,
  AutomationApiToggleTriggerInput,
  AutomationApiUpdateTriggerFiltersInput,
  AutomationApiUpsertInput,
} from "./automation.trpc-schemas.ts";
import type { EmailSuppression, EmailSuppressionRow, UnsubscribeView } from "./automation.ts";
import type { CustomGraphNameRef } from "./custom-graph.ts";
import type { AutomationPersistCapCount } from "./persist-cap.ts";
import type { TestFireInput, TestFireResult, TestFireTemplateDraft } from "./test-fire.ts";
import type { CreateTriggerCommand, UpdateTriggerCommand } from "./trigger.commands.ts";
import type { ReportSchedule, TriggerFire, TriggerFireStats } from "./trigger.queries.ts";
import type { Trigger } from "./trigger.ts";
import type { WebhookDeliveryRow } from "./webhook-delivery.ts";

/**
 * The caller a write is attributed to, as the door resolved them. It travels as
 * an argument so one operation serves a browser session, an API key and a
 * background job without knowing which it is serving.
 */
export interface AutomationAuthor {
  readonly id: string;
}

/** The same caller, plus the address a test fire is delivered to (ADR-031). */
export interface AutomationTestFireAuthor extends AutomationAuthor {
  /** Null for a caller whose account carries no address. */
  readonly email: string | null;
}

/** Which unsubscribe affordance a confirmation arrived through. */
export type UnsubscribeChannel = "link" | "one-click";

/**
 * What the install-wide usage report counts here (ADR-156, section 10): how
 * many triggers were made, since `since` where one is given, and when the
 * first was. Times are epoch milliseconds.
 */
export interface AutomationUsageCount {
  readonly triggers: number;
  readonly firstTriggerAt?: number;
}

/** Callable automation capability shared by transports and process peers. */
export interface AutomationApi {
  getAllForProject(input: { projectId: string }): Promise<Trigger[]>;
  /** Every automation the list renders: redacted, with its monitors and graph. */
  listAutomations(input: { projectId: string }): Promise<AutomationListRow[]>;
  findById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  /** One automation with every secret stripped, for a browser to read. */
  findRedactedById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  findLiveById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  getById(input: { triggerId: string; projectId: string }): Promise<Trigger>;
  findByCustomGraphId(input: { projectId: string; customGraphId: string }): Promise<Trigger | null>;
  getByCustomGraphIds(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]>;
  assertCustomGraphInProject(input: { customGraphId: string; projectId: string }): Promise<void>;
  customGraphExistsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean>;
  getCustomGraphNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]>;
  getMonitorsByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  resolvePersistDailyCap(projectId: string): Promise<number>;
  readPersistCapCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Instant;
    cap: number;
  }): Promise<Record<string, AutomationPersistCapCount>>;
  /** The ceiling and what each automation has spent of it today. */
  readDailyCapStatus(input: { projectId: string }): Promise<AutomationPersistCapStatus>;
  getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]>;
  getRecentFires(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]>;
  getRecentWebhookDeliveries(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]>;
  getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]>;
  /** The Slack conversations a bot token can see, for the channel picker. */
  listSlackChannels(input: AutomationApiListSlackChannelsInput): Promise<SlackChannelListing>;
  create(input: CreateTriggerCommand): Promise<Trigger>;
  createTraceAutomation(input: CreateTriggerCommand): Promise<Trigger>;
  /** The authoring surface's legacy create, with its per-action refusals. */
  createAutomation(input: AutomationApiCreateInput, author: AutomationAuthor): Promise<Trigger>;
  /** The authoring drawer's save: one row, whichever of the three kinds it is. */
  saveAutomation(input: AutomationApiUpsertInput, author: AutomationAuthor): Promise<Trigger>;
  /** Pausing and resuming, including the report's calendar entry. */
  setAutomationActive(input: AutomationApiToggleTriggerInput): Promise<Trigger>;
  /** Replaces one automation's condition, keeping it from matching everything. */
  replaceAutomationFilters(input: AutomationApiUpdateTriggerFiltersInput): Promise<Trigger>;
  update(input: UpdateTriggerCommand): Promise<Trigger>;
  delete(input: { triggerId: string; projectId: string }): Promise<void>;
  /** Deactivates and soft-deletes one automation in a single write. */
  softDeleteById(input: { triggerId: string; projectId: string }): Promise<Trigger>;
  syncReportSchedule(input: {
    projectId: string;
    triggerId: string;
    cron: string;
    timezone: string;
  }): Promise<void>;
  removeReportSchedule(input: { projectId: string; triggerId: string }): Promise<void>;
  invalidate(projectId: string): Promise<void>;
  assertTraceConditionPresent(filters: Record<string, unknown> | undefined): void;
  assertConditionSurvivesEdit(input: {
    existing: Trigger;
    filters: Record<string, unknown> | undefined;
  }): void;
  validateTemplateDraft(input: TestFireTemplateDraft): void;
  assertWebhookChannelEnabled(input: { projectId: string; userId: string }): Promise<void>;
  getProjectIdentity(projectId: string): Promise<{ name: string; slug: string }>;
  testFire(input: TestFireInput): Promise<TestFireResult>;
  /** The authoring drawer's test-fire button, throttled and self-addressed. */
  sendTestFire(
    input: AutomationApiTestFireInput,
    author: AutomationTestFireAuthor,
  ): Promise<TestFireResult>;
  findUnsubscribeView(input: {
    token: string;
  }): Promise<{ projectName: string; triggerName: string | null; email: string } | null>;
  /** The unsubscribe page's own read, throttled per caller (ADR-031). */
  resolveUnsubscribeView(input: {
    token: string;
    callerAddress: string | null;
  }): Promise<UnsubscribeView>;
  confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void>;
  /** The same confirmation from either affordance, throttled per caller. */
  acceptUnsubscribe(input: {
    token: string;
    scope: "trigger" | "project";
    callerAddress: string | null;
    via: UnsubscribeChannel;
  }): Promise<void>;
  /** The operator-facing suppression list, audited because it reads addresses. */
  listSuppressions(input: { projectId: string; actorId: string }): Promise<EmailSuppressionRow[]>;
  removeSuppression(input: { id: string; projectId: string }): Promise<void>;
  /** Every suppression for a project, each carrying the trigger name it names. */
  getAllEnriched(input: {
    projectId: string;
  }): Promise<(EmailSuppression & { triggerName: string | null })[]>;
  /**
   * The platform's own address for one automation resource, built from
   * the project's slug and the path the caller resolved. The REST
   * declaration has no request-scoped builder, so the app composes it.
   */
  platformUrl(input: { projectSlug: string; path: string }): string;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AutomationUsageCount>;
  /** A terminal evaluation: records a match per trace trigger whose filter reads evaluations. */
  handleEvaluationTriggerMatch(input: {
    event: AutomationEvaluationSubscriberEvent;
    context: AutomationEvaluationSubscriberContext;
  }): Promise<void>;
  /** A terminal evaluation: re-evaluates the project's graph alerts in real time. */
  handleEvaluationGraphTriggerActivity(input: {
    event: AutomationEvaluationSubscriberEvent;
    context: AutomationEvaluationActivityContext;
  }): Promise<void>;
}

export const AutomationApi = moduleApi<AutomationApi>()("automation");

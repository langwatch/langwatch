import { moduleApi } from "@langwatch/runtime-composition";
import type { Monitor } from "@langwatch/monitor-contract";
import type {
  AutomationApiCreateInput,
  AutomationApiListSlackChannelsInput,
  AutomationApiTestFireInput,
  AutomationApiToggleTriggerInput,
  AutomationApiUpdateTriggerFiltersInput,
  AutomationApiUpsertInput,
} from "./automation.trpc-schemas.ts";
import type {
  AutomationListRow,
  AutomationPersistCapStatus,
  SlackChannelListing,
} from "./automation.responses.ts";
import type { AutomationPersistCapCount } from "./persist-cap.ts";
import type { CustomGraphNameRef } from "./custom-graph.ts";
import type { EmailSuppressionRow, UnsubscribeView } from "./automation.ts";
import type { ReportSchedule, TriggerFire, TriggerFireStats } from "./trigger.queries.ts";
import type { CreateTriggerCommand, UpdateTriggerCommand } from "./trigger.commands.ts";
import type { Trigger } from "./trigger.ts";
import type { TestFireInput, TestFireResult, TestFireTemplateDraft } from "./test-fire.ts";
import type { WebhookDeliveryRow } from "./webhook-delivery.ts";
import type { Instant } from "@langwatch/time";

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

/** Callable automation capability shared by transports and process peers. */
export interface AutomationApi {
  getAllForProject(input: { projectId: string }): Promise<Trigger[]>;
  /** Every automation the list renders: redacted, with its monitors and graph. */
  listAutomations(input: { projectId: string }): Promise<AutomationListRow[]>;
  tryGetById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  /** One automation with every secret stripped, for a browser to read. */
  findRedactedById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  tryGetLiveById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
  requireById(input: { triggerId: string; projectId: string }): Promise<Trigger>;
  tryGetByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null>;
  getByCustomGraphIds(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]>;
  requireCustomGraphInProject(input: { customGraphId: string; projectId: string }): Promise<void>;
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
  tryResolveUnsubscribeView(input: {
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
}

export const AutomationApi = moduleApi<AutomationApi>("automation");

import { featureApi } from "@langwatch/runtime-composition/contract";
import type { Monitor } from "@langwatch/monitor-contract";
import type { AutomationPersistCapCount } from "./persist-cap.ts";
import type { CustomGraphNameRef } from "./custom-graph.ts";
import type { EmailSuppression } from "./automation.ts";
import type { ReportSchedule, TriggerFire, TriggerFireStats } from "./trigger.queries.ts";
import type { CreateTriggerCommand, UpdateTriggerCommand } from "./trigger.commands.ts";
import type { Trigger } from "./trigger.ts";
import type { TestFireInput, TestFireResult, TestFireTemplateDraft } from "./test-fire.ts";
import type { WebhookDeliveryRow } from "./webhook-delivery.ts";
import type { Instant } from "@langwatch/time";

/** Callable automation capability shared by transports and process peers. */
export interface AutomationApi {
  getAllForProject(input: { projectId: string }): Promise<Trigger[]>;
  tryGetById(input: { triggerId: string; projectId: string }): Promise<Trigger | null>;
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
  create(input: CreateTriggerCommand): Promise<Trigger>;
  createTraceAutomation(input: CreateTriggerCommand): Promise<Trigger>;
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
  tryResolveUnsubscribeView(input: {
    token: string;
  }): Promise<{ projectName: string; triggerName: string | null; email: string } | null>;
  confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void>;
  getSuppressionsEnriched(input: {
    projectId: string;
  }): Promise<Array<EmailSuppression & { triggerName: string | null }>>;
  removeSuppression(input: { id: string; projectId: string }): Promise<void>;
}

export const AutomationApi = featureApi<AutomationApi>("automation");

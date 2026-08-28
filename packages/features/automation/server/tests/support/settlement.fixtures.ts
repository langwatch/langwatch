import { AutomationService, type TriggerSummary } from "@langwatch/automation-contract";
import type { IntentContext } from "@langwatch/eventing";
import { ProjectService, type Project } from "@langwatch/project-contract";
import {
  TraceService,
  type DerivedTraceEvent,
  type TraceRecord,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { SlackProviderAdapter } from "../../src/adapters/slack-provider.adapter";
import { WebhookProviderAdapter } from "../../src/adapters/webhook-provider.adapter";
import { AutomationClock } from "../../src/ports/automation-clock.port";
import { AutomationEmailCapStorePort } from "../../src/ports/email-cap.port";
import { AutomationNotificationDeliveryPort } from "../../src/ports/automation-notification-delivery.port";
import {
  AutomationDatasetMapperPort,
  AutomationPersistActionWriterPort,
} from "../../src/ports/automation-persist-action.port";
import {
  AutomationSettlementMatchConfirmationPort,
  AutomationSettlementObservabilityPort,
} from "../../src/ports/automation-settlement.port";
import { AutomationEmailCapService } from "../../src/services/email-cap.service";
import { AutomationPersistActionService } from "../../src/services/persist-action.service";
import { AutomationSettlementDispatchService } from "../../src/services/trigger-settlement-dispatch.service";

function unavailable(): never {
  throw new Error("unused test capability");
}

export function settlementTrigger(
  action: TriggerSummary["action"],
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Settlement test",
    action,
    triggerKind: "AUTOMATION",
    actionParams: {},
    filters: {},
    filterQuery: null,
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 0,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

export function settlementContext(
  messageKey = "process:trigger-1:digest:1000:batch",
): IntentContext {
  return {
    processName: "triggerSettlement",
    projectId: "project-1",
    processKey: "trigger-1",
    tenantId: "project-1",
    messageKey,
    attempt: 1,
  };
}

export function settlementTrace(traceId: string): TraceRecord {
  return {
    trace_id: traceId,
    project_id: "project-1",
    metadata: { environment: "test" },
    timestamps: { started_at: 100, inserted_at: 100, updated_at: 100 },
    spans: [
      {
        span_id: "span-1",
        trace_id: traceId,
        type: "llm",
        timestamps: { started_at: 100, finished_at: 100 },
      },
    ],
  };
}

export function settlementSummary(
  traceId: string,
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId,
    traceName: "trace",
    spanCount: 1,
    totalDurationMs: 1,
    computedIOSchemaVersion: "1",
    computedInput: `input:${traceId}`,
    computedOutput: `output:${traceId}`,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: { "langwatch.origin": "application" },
    occurredAt: 100,
    createdAt: 100,
    updatedAt: 100,
    LastEventOccurredAt: 100,
    ...overrides,
  };
}

class SettlementAutomationService extends AutomationService {
  readonly claims: Array<{ triggerId: string; traceId: string; projectId: string }> = [];
  readonly lastRuns: Array<{ triggerId: string; projectId: string }> = [];
  readonly capInputs: Array<Record<string, unknown>> = [];
  readonly breachInputs: Array<Record<string, unknown>> = [];
  readonly webhookDeliveries: Array<Record<string, unknown>> = [];
  readonly claimed = new Set<string>();
  claimFailures = 0;
  activeTriggerReads = 0;
  persistCapReads = 0;
  breachError: unknown = null;
  activeTrigger: TriggerSummary | null;
  persistCap = 100;
  persistDecision = { allowed: true, count: 1, cap: 100, skipped: 0 };

  constructor(trigger: TriggerSummary) {
    super();
    this.activeTrigger = trigger;
  }

  validateTemplateDraft(): never {
    return unavailable();
  }
  testFire(): never {
    return unavailable();
  }
  evaluateGraphTrigger(): never {
    return unavailable();
  }
  decideGraphTriggerHeartbeat(): never {
    return unavailable();
  }
  getById(): never {
    return unavailable();
  }
  tryGetIdentity(): never {
    return unavailable();
  }
  tryGetById(): never {
    return unavailable();
  }
  getAllForProject(): never {
    return unavailable();
  }
  create(): never {
    return unavailable();
  }
  update(): never {
    return unavailable();
  }
  archive(): never {
    return unavailable();
  }
  softDeleteById(): never {
    return unavailable();
  }
  tryGetByCustomGraphId(): never {
    return unavailable();
  }
  getByCustomGraphIds(): never {
    return unavailable();
  }
  getActiveGraphTriggersForProject(): never {
    return unavailable();
  }
  invalidate(): never {
    return unavailable();
  }
  getReportSchedules(): never {
    return unavailable();
  }
  syncReportSchedule(): never {
    return unavailable();
  }
  removeReportSchedule(): never {
    return unavailable();
  }
  reconcileReportSchedules(): never {
    return unavailable();
  }
  getFireStats(): never {
    return unavailable();
  }
  getRecentFires(): never {
    return unavailable();
  }
  recordFire(): never {
    return unavailable();
  }
  getSuppressions(): never {
    return unavailable();
  }
  getAllEnriched(): never {
    return unavailable();
  }
  suppressEmail(): never {
    return unavailable();
  }
  removeSuppression(): never {
    return unavailable();
  }
  tryResolveUnsubscribeView(): never {
    return unavailable();
  }
  confirmUnsubscribe(): never {
    return unavailable();
  }
  tryGetCustomGraph(): never {
    return unavailable();
  }
  customGraphExistsInProject(): never {
    return unavailable();
  }
  getCustomGraphNamesByIds(): never {
    return unavailable();
  }
  getRecentWebhookDeliveries(): never {
    return unavailable();
  }
  pruneWebhookDeliveries(): never {
    return unavailable();
  }
  readPersistCapCounts(): never {
    return unavailable();
  }

  async getActiveTraceTriggersForProject(): Promise<TriggerSummary[]> {
    this.activeTriggerReads += 1;
    return this.activeTrigger ? [this.activeTrigger] : [];
  }

  async claimSend(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    this.claims.push(input);
    if (this.claimFailures > 0) {
      this.claimFailures -= 1;
      throw new Error("claim write failed");
    }
    this.claimed.add(input.traceId);
    return true;
  }

  async isSendClaimed(input: { traceId: string }): Promise<boolean> {
    return this.claimed.has(input.traceId);
  }

  async filterSendClaimed(input: { traceIds: string[] }): Promise<Set<string>> {
    return new Set(input.traceIds.filter((traceId) => this.claimed.has(traceId)));
  }

  async updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void> {
    this.lastRuns.push(input);
  }

  async filterSuppressed(input: { emails: string[] }): Promise<string[]> {
    return input.emails;
  }

  async resolvePersistDailyCap(): Promise<number> {
    this.persistCapReads += 1;
    return this.persistCap;
  }

  async consumePersistCapSlot(input: {
    projectId: string;
    triggerId: string;
    now: Date;
    cap: number;
    dedupKey: string;
  }) {
    this.capInputs.push(input);
    return this.persistDecision;
  }

  async handlePersistCapBreach(input: Record<string, unknown>): Promise<void> {
    this.breachInputs.push(input);
    if (this.breachError) throw this.breachError;
  }

  async recordWebhookDelivery(input: Record<string, unknown>): Promise<void> {
    this.webhookDeliveries.push(input);
  }
}

export class SettlementProjectService extends ProjectService {
  reads = 0;
  readonly project: Project = {
    id: "project-1",
    name: "Test project",
    slug: "test-project",
    apiKey: "api-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "typescript",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };

  tryFindInternal(): never {
    return unavailable();
  }
  ensureInternal(): never {
    return unavailable();
  }
  isPresenceEnabled(): never {
    return unavailable();
  }
  getById(): never {
    return unavailable();
  }
  async getOrganizationId(): Promise<string> {
    return "organization-1";
  }
  tryGetSummaryById(): never {
    return unavailable();
  }
  getWithTeam(): never {
    return unavailable();
  }
  tryGetWithTeam(): never {
    return unavailable();
  }
  create(): never {
    return unavailable();
  }
  update(): never {
    return unavailable();
  }
  archive(): never {
    return unavailable();
  }
  listByOrganization(): never {
    return unavailable();
  }
  listByTeam(): never {
    return unavailable();
  }
  listNamesByIds(): never {
    return unavailable();
  }
  listIdsByOrganization(): never {
    return unavailable();
  }
  listActiveByScopes(): never {
    return unavailable();
  }
  updateMetadata(): never {
    return unavailable();
  }
  touchCodingAgentSessionSeen(): never {
    return unavailable();
  }
  touchCodingAgentPullRequestSeen(): never {
    return unavailable();
  }
  searchByQuery(): never {
    return unavailable();
  }
  tryGetTraceSharingConfig(): never {
    return unavailable();
  }
  resolveOrgAdmin(): never {
    return unavailable();
  }
  resolveTraceDestination(): never {
    return unavailable();
  }
  tryGetTraceDestination(): never {
    return unavailable();
  }
  listTraceDestinations(): never {
    return unavailable();
  }

  async tryGetById(id: string): Promise<Project | null> {
    this.reads += 1;
    return id === this.project.id ? this.project : null;
  }
}

class SettlementTraceService extends TraceService {
  readonly summaries = new Map<string, TraceSummaryData>();
  readonly records = new Map<string, TraceRecord>();
  readonly recordErrors = new Map<string, unknown>();

  classifyQuery(): never {
    return unavailable();
  }
  getEvaluationSpans(): never {
    return unavailable();
  }
  getEvaluationEvents(): never {
    return unavailable();
  }
  getSpanTreePage(): never {
    return unavailable();
  }
  getSpanTreeDelta(): never {
    return unavailable();
  }
  buildQueryFieldCatalogue(): never {
    return unavailable();
  }
  resolveIngestWaitTimeout(): never {
    return unavailable();
  }

  async getById(input: { traceId: string }): Promise<TraceRecord> {
    const error = this.recordErrors.get(input.traceId);
    if (error) throw error;
    return this.records.get(input.traceId) ?? settlementTrace(input.traceId);
  }

  async deriveEvents(): Promise<DerivedTraceEvent[]> {
    return [];
  }

  async tryGetSummary(input: { traceId: string }): Promise<TraceSummaryData | null> {
    return this.summaries.get(input.traceId) ?? null;
  }
}

class SettlementConfirmation extends AutomationSettlementMatchConfirmationPort {
  readonly rejected = new Set<string>();

  async confirms(input: { traceId: string }): Promise<boolean> {
    return !this.rejected.has(input.traceId);
  }
}

class SettlementClock extends AutomationClock {
  now(): Date {
    return new Date("2026-01-01T00:00:00.000Z");
  }
}

class SettlementDelivery extends AutomationNotificationDeliveryPort {
  readonly legacyEmails: Array<Record<string, unknown>> = [];
  readonly emails: Array<Record<string, unknown>> = [];
  readonly slackWebhooks: Array<Record<string, unknown>> = [];
  readonly legacySlackWebhooks: Array<Record<string, unknown>> = [];
  readonly slackBots: Array<Record<string, unknown>> = [];
  readonly webhooks: Array<{ eventId: string }> = [];

  async sendLegacyEmail(input: Record<string, unknown>): Promise<void> {
    this.legacyEmails.push(input);
  }
  async sendEmail(input: Record<string, unknown>): Promise<void> {
    this.emails.push(input);
  }
  async sendSlackWebhook(input: Record<string, unknown>): Promise<void> {
    this.slackWebhooks.push(input);
  }
  async sendLegacySlackWebhook(input: Record<string, unknown>): Promise<void> {
    this.legacySlackWebhooks.push(input);
  }
  async sendSlackBot(input: Record<string, unknown>): Promise<void> {
    this.slackBots.push(input);
  }
  async sendWebhook(input: {
    eventId: string;
  }): Promise<{ eventId: string; status: number; body: string }> {
    this.webhooks.push(input);
    return { eventId: input.eventId, status: 200, body: "ok" };
  }
}

class SettlementEmailCapStore extends AutomationEmailCapStorePort {
  readonly claimKeys: string[] = [];
  private readonly counts = new Map<string, number>();

  async trySet(key: string): Promise<string> {
    this.claimKeys.push(key);
    return "OK";
  }

  async tryGet(key: string): Promise<string | null> {
    const count = this.counts.get(key);
    return count === void 0 ? null : String(count);
  }

  async incr(key: string): Promise<number> {
    return this.increment(key, 1);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.increment(key, increment);
  }

  async eval(): Promise<void> {}

  private increment(key: string, increment: number): number {
    const count = (this.counts.get(key) ?? 0) + increment;
    this.counts.set(key, count);
    return count;
  }
}

class SettlementMapper extends AutomationDatasetMapperPort {
  map(input: { trace: TraceRecord }): Array<Record<string, string | number>> {
    return [{ traceId: input.trace.trace_id }];
  }
}

class SettlementWriter extends AutomationPersistActionWriterPort {
  readonly annotationWrites: Array<Record<string, unknown>> = [];
  readonly datasetWrites: Array<{ datasetRecords: Array<{ id: string }> }> = [];
  readonly errors = new Map<string, unknown>();

  async addToAnnotationQueue(input: Record<string, unknown>): Promise<void> {
    this.annotationWrites.push(input);
  }

  async addToDataset(input: { datasetRecords: Array<{ id: string }> }): Promise<void> {
    const recordId = input.datasetRecords[0]?.id ?? "";
    const errorEntry = [...this.errors].find(([traceId]) => recordId.includes(traceId));
    const error = errorEntry?.[1];
    if (error) throw error;
    this.datasetWrites.push(input);
  }
}

class SettlementObservability extends AutomationSettlementObservabilityPort {
  readonly overflows: number[] = [];
  readonly captures: Array<{ error: Error; extra: Record<string, unknown> }> = [];

  recordOverflow(flushed: number): void {
    this.overflows.push(flushed);
  }
  capture(error: Error, extra: Record<string, unknown>): void {
    this.captures.push({ error, extra });
  }
}

export function createSettlementFixture(trigger: TriggerSummary) {
  const automation = new SettlementAutomationService(trigger);
  const projects = new SettlementProjectService();
  const traces = new SettlementTraceService();
  const confirmation = new SettlementConfirmation();
  const delivery = new SettlementDelivery();
  const writer = new SettlementWriter();
  const observability = new SettlementObservability();
  const clock = new SettlementClock();
  const emailCapStore = new SettlementEmailCapStore();
  traces.summaries.set("trace-1", settlementSummary("trace-1"));
  traces.summaries.set("trace-2", settlementSummary("trace-2"));
  traces.records.set("trace-1", settlementTrace("trace-1"));
  traces.records.set("trace-2", settlementTrace("trace-2"));
  const crypto = { encrypt: (value: string) => value, decrypt: (value: string) => value };
  const persistActions = AutomationPersistActionService.create({
    automation,
    projects,
    traces,
    mapper: new SettlementMapper(),
    writer,
  });
  const service = AutomationSettlementDispatchService.create({
    automation,
    projects,
    traces,
    confirmation,
    persistActions,
    delivery,
    emailCaps: AutomationEmailCapService.create({ store: emailCapStore }),
    slack: SlackProviderAdapter.create(crypto),
    webhooks: WebhookProviderAdapter.create(crypto),
    clock,
    observability,
    baseHost: "https://app.example.com",
    emailHourlyCap: 100,
    tenantDailyCap: 1_000,
  });

  return {
    service,
    automation,
    projects,
    traces,
    confirmation,
    delivery,
    writer,
    observability,
    emailCapStore,
  };
}

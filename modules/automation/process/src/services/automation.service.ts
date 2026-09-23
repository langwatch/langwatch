import {
  createTriggerCommandSchema,
  InvalidUnsubscribeTokenError,
  maskEmail,
  suppressEmailCommandSchema,
  type CreateTriggerCommand,
  type CustomGraph,
  type CustomGraphNameRef,
  type EmailSuppression,
  type ReportSchedule,
  type SuppressEmailCommand,
  type Trigger,
  type TriggerFire,
  type TriggerFireStats,
  type TriggerSummary,
  type UpdateTriggerCommand,
  updateTriggerCommandSchema,
  type GraphTriggerEvaluationReason,
  type GraphTriggerEvaluationResult,
  type GraphTriggerSweepCandidate,
  type AutomationPersistCapBreach,
  type TestFireInput,
  type TestFireResult,
  type TestFireTemplateDraft,
  type WebhookDeliveryInput,
  type WebhookDeliveryRow,
  type AutomationPersistCapCount,
  type AutomationPersistCapDecision,
  type AutomationUsageCount,
} from "@langwatch/automation-contract";
import { type Instant } from "@langwatch/time";

import type { AutomationClock } from "../app/automation.members.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type { EmailSuppressionNameRepository } from "../repositories/email-suppression-name.repository.ts";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { TriggerFireHistoryRepository } from "../repositories/trigger-fire-history.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.ts";
import type { UnsubscribeTokenVerifier } from "../services/unsubscribe-token.service.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";
import type { AutomationTemplateService } from "./automation-template.service.ts";
import type { AutomationPersistCapService } from "./persist-cap.service.ts";
import type { ReportScheduleService } from "./report-schedule.service.ts";
import type { AutomationGraphService } from "./trigger-graph.service.ts";

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * The automation feature's own trigger-and-suppression service, narrowed
 * by the graph-activity and settlement-ledger ports. Folded out of the
 * contract package per ADR-133; the sole definition, server-side.
 */
export class AutomationService {
  private readonly activeCache: ActiveTriggerCacheService;
  private readonly triggers: TriggerRepository;
  private readonly history: TriggerFireHistoryRepository;
  private readonly suppressions: EmailSuppressionRepository;
  private readonly names: EmailSuppressionNameRepository;
  private readonly verifier: UnsubscribeTokenVerifier;
  private readonly reportSchedules: ReportScheduleService;
  private readonly clock: AutomationClock;
  private readonly customGraphs: CustomGraphRepository;
  private readonly webhookDeliveries: WebhookDeliveryRepository;
  private readonly graph: AutomationGraphService;
  private readonly templates: AutomationTemplateService;
  private readonly persistCaps: AutomationPersistCapService;

  private constructor({
    triggers,
    history,
    suppressions,
    names,
    verifier,
    reportSchedules,
    clock,
    customGraphs,
    webhookDeliveries,
    graph,
    templates,
    persistCaps,
  }: {
    triggers: TriggerRepository;
    history: TriggerFireHistoryRepository;
    suppressions: EmailSuppressionRepository;
    names: EmailSuppressionNameRepository;
    verifier: UnsubscribeTokenVerifier;
    reportSchedules: ReportScheduleService;
    clock: AutomationClock;
    customGraphs: CustomGraphRepository;
    webhookDeliveries: WebhookDeliveryRepository;
    graph: AutomationGraphService;
    templates: AutomationTemplateService;
    persistCaps: AutomationPersistCapService;
  }) {
    this.triggers = triggers;
    this.history = history;
    this.suppressions = suppressions;
    this.names = names;
    this.verifier = verifier;
    this.reportSchedules = reportSchedules;
    this.clock = clock;
    this.customGraphs = customGraphs;
    this.webhookDeliveries = webhookDeliveries;
    this.graph = graph;
    this.templates = templates;
    this.persistCaps = persistCaps;
    this.activeCache = ActiveTriggerCacheService.create({ triggers, clock });
  }

  static create(deps: {
    triggers: TriggerRepository;
    history: TriggerFireHistoryRepository;
    suppressions: EmailSuppressionRepository;
    names: EmailSuppressionNameRepository;
    verifier: UnsubscribeTokenVerifier;
    reportSchedules: ReportScheduleService;
    clock: AutomationClock;
    customGraphs: CustomGraphRepository;
    webhookDeliveries: WebhookDeliveryRepository;
    graph: AutomationGraphService;
    templates: AutomationTemplateService;
    persistCaps: AutomationPersistCapService;
  }): AutomationService {
    return new AutomationService({
      triggers: deps.triggers,
      history: deps.history,
      suppressions: deps.suppressions,
      names: deps.names,
      verifier: deps.verifier,
      reportSchedules: deps.reportSchedules,
      clock: deps.clock,
      customGraphs: deps.customGraphs,
      webhookDeliveries: deps.webhookDeliveries,
      graph: deps.graph,
      templates: deps.templates,
      persistCaps: deps.persistCaps,
    });
  }

  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AutomationUsageCount> {
    return this.triggers.countUsage(input);
  }

  validateTemplateDraft(input: TestFireTemplateDraft): void {
    this.templates.validate(input);
  }

  testFire(input: TestFireInput): Promise<TestFireResult> {
    return this.templates.testFire(input);
  }

  evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return this.graph.evaluate(input);
  }

  async decideGraphTriggerHeartbeat(input: {
    now: Instant;
  }): Promise<GraphTriggerSweepCandidate[]> {
    return this.graph.decideHeartbeat(input);
  }

  handlePersistCapBreach(input: AutomationPersistCapBreach): Promise<void> {
    return this.graph.handlePersistCapBreach(input);
  }

  resolvePersistDailyCap(projectId: string): Promise<number> {
    return this.persistCaps.resolvePersistDailyCap(projectId);
  }

  consumePersistCapSlot(input: {
    projectId: string;
    triggerId: string;
    now: Instant;
    cap: number;
    dedupKey: string;
  }): Promise<AutomationPersistCapDecision> {
    return this.persistCaps.consumePersistCapSlot(input);
  }

  readPersistCapCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Instant;
    cap: number;
  }): Promise<Record<string, AutomationPersistCapCount>> {
    return this.persistCaps.readPersistCapCounts(input);
  }

  getById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    return this.triggers.findByIdOrThrow(input);
  }

  findById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    return this.triggers.findById(input);
  }

  getAllForProject(input: { projectId: string }): Promise<Trigger[]> {
    return this.triggers.findAllByProjectId(input);
  }

  async create(input: CreateTriggerCommand): Promise<Trigger> {
    const trigger = await this.triggers.create(createTriggerCommandSchema.parse(input));
    await this.invalidate(input.projectId);

    return trigger;
  }

  async update(input: UpdateTriggerCommand): Promise<Trigger> {
    const trigger = await this.triggers.update(updateTriggerCommandSchema.parse(input));
    await this.invalidate(input.projectId);

    return trigger;
  }

  async archive(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    await this.getById(input);
    const trigger = await this.triggers.update({
      id: input.triggerId,
      projectId: input.projectId,
      active: false,
    });
    await this.invalidate(input.projectId);

    return trigger;
  }

  async softDeleteById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const trigger = await this.triggers.update({
      id: input.triggerId,
      projectId: input.projectId,
      active: false,
      deleted: true,
    });
    await this.invalidate(input.projectId);

    return trigger;
  }

  findByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    return this.triggers.findByCustomGraphId(input);
  }

  getByCustomGraphIds(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]> {
    return this.triggers.findByCustomGraphIds(input);
  }

  getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.activeCache.getActiveTraceTriggersForProject(projectId);
  }

  getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.activeCache.getActiveGraphTriggersForProject(projectId);
  }

  claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean> {
    return this.triggers.claimSend(input);
  }

  isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.triggers.isSendClaimed(input);
  }

  filterSendClaimed(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>> {
    return this.triggers.findClaimedTraceIds(input);
  }

  updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void> {
    return this.triggers.updateLastRunAt(input);
  }

  invalidate(projectId: string): Promise<void> {
    this.activeCache.invalidate(projectId);

    return Promise.resolve();
  }

  getReportSchedules(input: { projectId: string }): Promise<ReportSchedule[]> {
    return this.reportSchedules.getAll(input);
  }

  syncReportSchedule(input: {
    projectId: string;
    triggerId: string;
    cron: string;
    timezone: string;
  }): Promise<void> {
    return this.reportSchedules.sync({
      projectId: input.projectId,
      triggerId: input.triggerId,
      schedule: { cron: input.cron, timezone: input.timezone },
    });
  }

  removeReportSchedule(input: { projectId: string; triggerId: string }): Promise<void> {
    return this.reportSchedules.remove(input);
  }

  reconcileReportSchedules(): Promise<{ repaired: number }> {
    return this.reportSchedules.reconcile();
  }

  getFireStats(input: { projectId: string }): Promise<TriggerFireStats[]> {
    return this.history.findAllStatsForProject({
      projectId: input.projectId,
      firesSince: this.clock.now().subtract({ milliseconds: 30 * 24 * 60 * 60 * 1000 }),
    });
  }

  getRecentFires(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return input.triggerId
      ? this.history.findAllRecentByTriggerId({
          projectId: input.projectId,
          triggerId: input.triggerId,
          limit: input.limit,
        })
      : this.history.findAllRecentForProject({
          projectId: input.projectId,
          limit: input.limit,
        });
  }

  recordFire(input: {
    projectId: string;
    triggerId: string;
    traceId?: string | null;
    customGraphId?: string | null;
    createdAt: Instant;
    resolvedAt?: Instant | null;
  }): Promise<TriggerFire> {
    return this.history.create({
      projectId: input.projectId,
      triggerId: input.triggerId,
      traceId: input.traceId ?? null,
      customGraphId: input.customGraphId ?? null,
      createdAt: input.createdAt,
      resolvedAt: input.resolvedAt ?? null,
    });
  }

  getSuppressions(input: { projectId: string }): Promise<EmailSuppression[]> {
    return this.suppressions.findAll(input);
  }

  async getAllEnriched(input: {
    projectId: string;
  }): Promise<(EmailSuppression & { triggerName: string | null })[]> {
    const rows = await this.suppressions.findAll(input);
    const ids = [...new Set(rows.flatMap((row) => (row.triggerId ? [row.triggerId] : [])))];
    const names = await this.names.findTriggerNames({
      projectId: input.projectId,
      triggerIds: ids,
    });

    return rows.map((row) => ({
      ...row,
      triggerName: row.triggerId ? (names.get(row.triggerId) ?? null) : null,
    }));
  }

  async findUnsubscribeView(input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null> {
    const payload = this.verifier.findVerifiedPayload(input.token);
    if (!payload) {
      return null;
    }

    const names = await this.names.findNames(payload);
    if (!names) {
      return null;
    }

    return {
      projectName: names.projectName,
      triggerName: names.triggerName,
      email: maskEmail(payload.email),
    };
  }

  async confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    const payload = this.verifier.findVerifiedPayload(input.token);
    if (!payload) {
      throw new InvalidUnsubscribeTokenError();
    }

    await this.suppressEmail({
      projectId: payload.projectId,
      email: payload.email,
      triggerId: input.scope === "project" ? null : payload.triggerId,
    });
  }

  suppressEmail(input: SuppressEmailCommand): Promise<EmailSuppression> {
    const parsed = suppressEmailCommandSchema.parse(input);

    return this.suppressions.create({
      projectId: parsed.projectId,
      email: normalize(parsed.email),
      triggerId: parsed.triggerId,
      reason: parsed.reason ?? "unsubscribe",
    });
  }

  removeSuppression(input: { id: string; projectId: string }): Promise<void> {
    return this.suppressions.delete(input);
  }

  async filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    const rows = await this.suppressions.findMatching({
      projectId: input.projectId,
      triggerId: input.triggerId,
    });
    const blocked = new Set(rows.map((row) => normalize(row.email)));

    return input.emails.filter((email) => !blocked.has(normalize(email)));
  }

  findCustomGraph(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return this.customGraphs.findById(input);
  }

  customGraphExistsInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.customGraphs.existsInProject(input);
  }

  getCustomGraphNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.customGraphs.findAllNamesByIds(input);
  }

  recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void> {
    return this.webhookDeliveries.create(input);
  }

  getRecentWebhookDeliveries(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    return this.webhookDeliveries.findAllRecentByTriggerId(input);
  }

  pruneWebhookDeliveries(now?: Instant): Promise<number> {
    return this.webhookDeliveries.pruneExpired(now);
  }
}

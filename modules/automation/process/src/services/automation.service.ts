import {
  createTriggerCommandSchema,
  type AutomationApiFireHistoryInput,
  type AutomationApiTriggerScope,
  type NextFiring,
  type TriggerFirePage,
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
  type WebhookDeliveryRow,
  type AutomationPersistCapCount,
  type AutomationPersistCapDecision,
  type AutomationUsageCount,
} from "@langwatch/automation-contract";
import { type Instant } from "@langwatch/time";
import type { WebhookApi } from "@langwatch/webhook-contract";

import type { AutomationClock } from "../app/automation.members.ts";
import { GRAPH_ALERT_SWEEP_INTERVAL_MS } from "../eventing/graph-alert-sweep.process.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type { EmailSuppressionNameRepository } from "../repositories/email-suppression-name.repository.ts";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { TriggerFireHistoryRepository } from "../repositories/trigger-fire-history.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import { describeNextFiring } from "../rules/next-firing.rules.ts";
import type { UnsubscribeTokenVerifier } from "../services/unsubscribe-token.service.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";
import { AutomationEmailSuppressionService } from "./automation-email-suppression.service.ts";
import type { AutomationSlackConnectionService } from "./automation-slack-connection.service.ts";
import type { AutomationTemplateService } from "./automation-template.service.ts";
import type { AutomationPersistCapService } from "./persist-cap.service.ts";
import type { ReportScheduleService } from "./report-schedule.service.ts";
import type { AutomationGraphService } from "./trigger-graph.service.ts";

/** The webhook module's log of this module's webhook attempts (ADR-167). */
type WebhookDeliveryLog = Pick<WebhookApi, "findDeliveriesBySource">;

/**
 * The automation feature's own trigger-and-suppression service, narrowed
 * by the graph-activity and settlement-ledger ports. Folded out of the
 * contract package per ADR-133; the sole definition, server-side.
 */

export class AutomationService {
  private readonly activeCache: ActiveTriggerCacheService;
  private readonly triggers: TriggerRepository;
  private readonly history: TriggerFireHistoryRepository;
  private readonly emailSuppressions: AutomationEmailSuppressionService;
  private readonly reportSchedules: ReportScheduleService;
  private readonly clock: AutomationClock;
  private readonly customGraphs: CustomGraphRepository;
  private readonly webhookDeliveries: WebhookDeliveryLog;
  private readonly graph: AutomationGraphService;
  private readonly templates: AutomationTemplateService;
  private readonly persistCaps: AutomationPersistCapService;
  private readonly slackConnections: AutomationSlackConnectionService;

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
    slackConnections,
  }: {
    triggers: TriggerRepository;
    history: TriggerFireHistoryRepository;
    suppressions: EmailSuppressionRepository;
    names: EmailSuppressionNameRepository;
    verifier: UnsubscribeTokenVerifier;
    reportSchedules: ReportScheduleService;
    clock: AutomationClock;
    customGraphs: CustomGraphRepository;
    webhookDeliveries: WebhookDeliveryLog;
    graph: AutomationGraphService;
    templates: AutomationTemplateService;
    persistCaps: AutomationPersistCapService;
    slackConnections: AutomationSlackConnectionService;
  }) {
    this.triggers = triggers;
    this.history = history;
    this.emailSuppressions = AutomationEmailSuppressionService.create({
      suppressions,
      names,
      verifier,
    });
    this.reportSchedules = reportSchedules;
    this.clock = clock;
    this.customGraphs = customGraphs;
    this.webhookDeliveries = webhookDeliveries;
    this.graph = graph;
    this.templates = templates;
    this.persistCaps = persistCaps;
    this.slackConnections = slackConnections;
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
    webhookDeliveries: WebhookDeliveryLog;
    graph: AutomationGraphService;
    templates: AutomationTemplateService;
    persistCaps: AutomationPersistCapService;
    slackConnections: AutomationSlackConnectionService;
  }): AutomationService {
    return new AutomationService(deps);
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

  /** A Slack create is pointed at a connection first, then claims it (ARCHITECTURE.md §3). */
  async create(input: CreateTriggerCommand): Promise<Trigger> {
    const { actorId, ...command } = createTriggerCommandSchema.parse(input);
    const actionParams =
      command.action === "SEND_SLACK_MESSAGE"
        ? await this.slackConnections.connectActionParams({
            projectId: command.projectId,
            actorId: actorId ?? `svc_${command.projectId}`,
            actionParams: command.actionParams,
          })
        : command.actionParams;
    const trigger = await this.triggers.create({ ...command, actionParams });
    await this.updateSlackClaim({ before: undefined, after: trigger });
    await this.invalidate(input.projectId);

    return trigger;
  }

  async update(input: UpdateTriggerCommand): Promise<Trigger> {
    const command = updateTriggerCommandSchema.parse(input);
    const before = await this.triggers.findById({
      triggerId: command.id,
      projectId: command.projectId,
    });
    const trigger = await this.triggers.update(command);
    await this.updateSlackClaim({ before: before ?? undefined, after: trigger });
    await this.invalidate(input.projectId);

    return trigger;
  }

  async archive(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const before = await this.getById(input);
    const trigger = await this.triggers.update({
      id: input.triggerId,
      projectId: input.projectId,
      active: false,
    });
    await this.updateSlackClaim({ before, after: trigger });
    await this.invalidate(input.projectId);

    return trigger;
  }

  async softDeleteById(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const before = await this.triggers.findById(input);
    const trigger = await this.triggers.update({
      id: input.triggerId,
      projectId: input.projectId,
      active: false,
      deleted: true,
    });
    await this.updateSlackClaim({ before: before ?? undefined, after: undefined });
    await this.invalidate(input.projectId);

    return trigger;
  }

  /** Moves a Slack trigger's connection claim across one write; a failed claim fails the save. */
  private async updateSlackClaim({
    before,
    after,
  }: {
    before: Trigger | undefined;
    after: Trigger | undefined;
  }): Promise<void> {
    const trigger = after ?? before;
    const live = (row: Trigger | undefined) =>
      row && !row.deleted && row.action === "SEND_SLACK_MESSAGE"
        ? { actionParams: row.actionParams, active: row.active }
        : undefined;
    if (!trigger || (!live(before) && !live(after))) return;
    await this.slackConnections.updateConnectionClaim({
      projectId: trigger.projectId,
      trigger: { id: trigger.id, name: trigger.name },
      before: live(before),
      after: live(after),
    });
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

  /** When the automation acts next; `trigger_not_found` on a miss. */
  async getNextFiring(input: AutomationApiTriggerScope): Promise<NextFiring> {
    const trigger = await this.getById(input);
    const schedules =
      trigger.triggerKind === "REPORT"
        ? await this.getReportSchedules({ projectId: input.projectId })
        : [];
    return describeNextFiring({
      trigger,
      reportSchedule: schedules.find((schedule) => schedule.triggerId === trigger.id) ?? null,
      now: this.clock.now(),
      sweepIntervalMs: GRAPH_ALERT_SWEEP_INTERVAL_MS,
    });
  }

  /** Main's view read: a page of fires, empty (not refused) for a trigger that is not there. */
  listFireHistoryPage(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    return this.history.listPageByTriggerId(input);
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
    return this.emailSuppressions.getSuppressions(input);
  }

  getAllEnriched(input: {
    projectId: string;
  }): Promise<(EmailSuppression & { triggerName: string | null })[]> {
    return this.emailSuppressions.getAllEnriched(input);
  }

  findUnsubscribeView(input: {
    token: string;
  }): Promise<{ projectName: string; triggerName: string | null; email: string } | null> {
    return this.emailSuppressions.findUnsubscribeView(input);
  }

  confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    return this.emailSuppressions.confirmUnsubscribe(input);
  }

  suppressEmail(input: SuppressEmailCommand): Promise<EmailSuppression> {
    return this.emailSuppressions.suppressEmail(input);
  }

  removeSuppression(input: { id: string; projectId: string }): Promise<void> {
    return this.emailSuppressions.removeSuppression(input);
  }

  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    return this.emailSuppressions.filterSuppressed(input);
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

  async getRecentWebhookDeliveries(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    const rows = await this.webhookDeliveries.findDeliveriesBySource({
      projectId: input.projectId,
      source: { module: "automation", ref: input.triggerId },
      limit: input.limit,
    });
    return rows.map(({ ref, ...row }) => ({ ...row, triggerId: ref }));
  }
}

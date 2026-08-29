import { describe, expect, it, vi } from "vitest";
import type {
  EmailSuppression,
  Trigger,
  TriggerFire,
  TriggerFireStats,
  TriggerSummary,
} from "@langwatch/automation-contract";
import { AutomationService } from "../automation.service";
import { EmailSuppressionRepository } from "../../repositories/email-suppression.repository";
import { EmailSuppressionNameRepository } from "../../repositories/email-suppression-name.repository";
import { TriggerFireHistoryRepository } from "../../repositories/trigger-fire-history.repository";
import { TriggerRepository } from "../../repositories/trigger.repository";
import type { ReportScheduleTarget } from "../../repositories/trigger.repository";
import { UnsubscribeTokenVerifier } from "../../ports/unsubscribe-token.port";
import { ReportScheduleService } from "../report-schedule.service";
import { AutomationClock } from "../../ports/automation-clock.port";
import { ScheduledJobStore } from "../../ports/scheduled-jobs.port";
import type { ScheduledJobRecord } from "../../ports/scheduled-jobs.port";
import { SchedulerWake } from "../../ports/scheduler-wake.port";
import { CustomGraphRepository } from "../../repositories/custom-graph.repository";
import { WebhookDeliveryRepository } from "../../repositories/webhook-delivery.repository";
import { GraphTriggerSentRepository } from "../../repositories/graph-trigger-sent.repository";
import { AutomationGraphService } from "../trigger-graph.service";
import { AutomationTemplateService } from "../automation-template.service";
import { AutomationPersistCapService } from "../persist-cap.service";
import type { WebhookDeliveryInput, WebhookDeliveryRow } from "@langwatch/automation-contract";
import { createAutomationTestRuntime } from "../../testing";

class EmptyGraphTriggerSent extends GraphTriggerSentRepository {
  findProjectsWithGraphTriggers = async () => [];
  findProjectsWithOpenGraphTriggerSent = async () => new Set<string>();
  tryFindGraphTriggerSource = async () => undefined;
  findOpenTriggerIdsForProject = async () => new Set<string>();
  tryFindOpenForGraphAlert = async () => null;
  tryFindLatestForGraphAlert = async () => null;
  tryClaimOpenForGraphAlert = async () => null;
  deleteOpenClaim = async () => undefined;
  markResolvedById = async () => undefined;
}

class EmptyCustomGraphs extends CustomGraphRepository {
  tryFindById(): Promise<null> {
    return Promise.resolve(null);
  }
  existsInProject(): Promise<boolean> {
    return Promise.resolve(false);
  }
  findAllNamesByIds(): Promise<[]> {
    return Promise.resolve([]);
  }
}
class EmptyWebhookDeliveries extends WebhookDeliveryRepository {
  create = vi.fn(async (_input: WebhookDeliveryInput) => undefined);
  findAllRecentByTriggerId = vi.fn(async () => [] as WebhookDeliveryRow[]);
  pruneExpired = vi.fn(async () => 0);
}
const suppression = (email: string, triggerId: string | null): EmailSuppression => ({
  id: `${email}-${triggerId ?? "all"}`,
  projectId: "p",
  email,
  triggerId,
  reason: "unsubscribe",
  createdAt: new Date(),
});

const summary = (id: string, overrides: Partial<TriggerSummary> = {}): TriggerSummary => ({
  id,
  projectId: "p",
  name: id,
  action: "SEND_EMAIL",
  triggerKind: "AUTOMATION",
  actionParams: {},
  filters: {},
  filterQuery: null,
  alertType: null,
  message: null,
  customGraphId: null,
  notificationCadence: "immediate",
  traceDebounceMs: 30_000,
  templates: {
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
  },
  ...overrides,
});
class Suppressions extends EmailSuppressionRepository {
  rows: EmailSuppression[] = [];
  findAll() {
    return Promise.resolve(this.rows);
  }
  findMatching(input: { triggerId: string }) {
    return Promise.resolve(
      this.rows.filter((row) => row.triggerId === null || row.triggerId === input.triggerId),
    );
  }
  create(input: { projectId: string; email: string; triggerId: string | null; reason: string }) {
    const row = suppression(input.email, input.triggerId);
    this.rows.push(row);
    return Promise.resolve(row);
  }
  delete() {
    return Promise.resolve();
  }
}
class Names extends EmailSuppressionNameRepository {
  tryLookupNames() {
    return Promise.resolve(null);
  }
  findTriggerNames() {
    return Promise.resolve(new Map<string, string>());
  }
}
class Verifier extends UnsubscribeTokenVerifier {
  tryVerify() {
    return null;
  }
}
class Jobs extends ScheduledJobStore {
  rows: ScheduledJobRecord[] = [];
  async upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Date;
  }) {
    this.rows = [
      ...this.rows.filter((row) => row.targetId !== input.targetId),
      {
        targetId: input.targetId,
        nextRunAt: input.nextRunAt,
        lastSlot: null,
        active: true,
      },
    ];
  }
  async deactivateForTarget(input: { projectId: string; targetType: string; targetId: string }) {
    for (const row of this.rows) {
      if (row.targetId === input.targetId) row.active = false;
    }
  }
  findAllForProject(): Promise<ScheduledJobRecord[]> {
    return Promise.resolve(this.rows);
  }
}
class Clock extends AutomationClock {
  now() {
    return new Date("2026-01-01T00:00:00Z");
  }
}
class Wake extends SchedulerWake {
  publish() {}
}
class Triggers extends TriggerRepository {
  reportTargets: ReportScheduleTarget[] = [];
  rowsByProject = new Map<string, TriggerSummary[]>();
  findActiveCalls = 0;
  claimSendCalls: Array<{
    triggerId: string;
    traceId: string;
    projectId: string;
  }> = [];
  findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    this.findActiveCalls++;
    return Promise.resolve(this.rowsByProject.get(projectId) ?? []);
  }
  findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
    return Promise.resolve(this.reportTargets);
  }
  claimSend(input: { triggerId: string; traceId: string; projectId: string }) {
    this.claimSendCalls.push(input);
    return Promise.resolve(true);
  }
  isSendClaimed() {
    return Promise.resolve(false);
  }
  findClaimedTraceIds() {
    return Promise.resolve(new Set<string>());
  }
  updateLastRunAt() {
    return Promise.resolve();
  }
  findByIdOrThrow(): Promise<Trigger> {
    return Promise.reject(new Error("unused"));
  }
  tryFindById() {
    return Promise.resolve(null);
  }
  findAllByProjectId(): Promise<Trigger[]> {
    return Promise.resolve([]);
  }
  tryFindByCustomGraphId() {
    return Promise.resolve(null);
  }
  findByCustomGraphIds() {
    return Promise.resolve([]);
  }
  create() {
    return Promise.reject(new Error("unused"));
  }
  update() {
    return Promise.reject(new Error("unused"));
  }
}
class Fires extends TriggerFireHistoryRepository {
  stats: TriggerFireStats[] = [];
  fires: TriggerFire[] = [];
  create = vi.fn(
    async (input: {
      projectId: string;
      triggerId: string;
      traceId: string | null;
      customGraphId: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
    }) => ({
      id: "fire-1",
      triggerId: input.triggerId,
      customGraphId: input.customGraphId,
      createdAt: input.createdAt,
      resolvedAt: input.resolvedAt,
    }),
  );
  findAllStatsForProject = vi.fn(
    async (_input: { projectId: string; firesSince: Date }) => this.stats,
  );
  findAllRecentByTriggerId = vi.fn(
    async (_input: { projectId: string; triggerId: string; limit: number }) => this.fires,
  );
  findAllRecentForProject = vi.fn(
    async (_input: { projectId: string; limit: number }) => this.fires,
  );
  findStats(): Promise<TriggerFireStats[]> {
    return Promise.resolve([]);
  }
  findRecent(): Promise<TriggerFire[]> {
    return Promise.resolve([]);
  }
}

const makeService = (
  triggers = new Triggers(),
  history = new Fires(),
  webhookDeliveries = new EmptyWebhookDeliveries(),
  reportSchedules = ReportScheduleService.create({
    jobs: new Jobs(),
    clock: new Clock(),
    wake: new Wake(),
  }),
  suppressions = new Suppressions(),
): AutomationService =>
  (() => {
    const runtime = createAutomationTestRuntime();
    const clock = new Clock();
    const customGraphs = new EmptyCustomGraphs();
    const graph = AutomationGraphService.create({
      triggers,
      customGraphs,
      projects: runtime.projects,
      analytics: runtime.analytics,
      triggerSent: new EmptyGraphTriggerSent(),
      notifier: runtime.notifier,
      logger: runtime.logger,
      slackTokens: runtime.slackTokens,
      dispatchErrors: runtime.dispatchErrors,
      heartbeat: runtime.heartbeat,
      runaway: runtime.runaway,
      clock,
      baseHost: runtime.baseHost,
    });
    const templates = AutomationTemplateService.create({
      baseHost: runtime.baseHost,
      delivery: runtime.testFire,
    });
    const persistCaps = AutomationPersistCapService.create({
      projects: runtime.projects,
      planProvider: {
        getActivePlan: async () => ({ type: "FREE", free: true }),
      },
      config: { free: 100, paid: 1_000, enterprise: 10_000 },
      redis: null,
    });
    return AutomationService.create({
      triggers,
      history,
      suppressions,
      names: new Names(),
      verifier: new Verifier(),
      reportSchedules,
      clock,
      customGraphs,
      webhookDeliveries,
      graph,
      templates,
      persistCaps,
    });
  })();

describe("AutomationService trigger and fire-history lifecycle", () => {
  it("keeps reports out of trace and graph dispatch projections", async () => {
    const triggers = new Triggers();
    triggers.rowsByProject.set("p", [
      summary("trace"),
      summary("graph", { customGraphId: "g1" }),
      summary("report", { triggerKind: "REPORT", customGraphId: "g2" }),
    ]);
    const service = makeService(triggers);

    expect(
      (await service.getActiveTraceTriggersForProject("p")).map((trigger) => trigger.id),
    ).toEqual(["trace"]);
    expect(
      (await service.getActiveGraphTriggersForProject("p")).map((trigger) => trigger.id),
    ).toEqual(["graph"]);
  });

  it("caches active projections until the project is invalidated", async () => {
    const triggers = new Triggers();
    triggers.rowsByProject.set("p", [summary("trace")]);
    const service = makeService(triggers);

    await service.getActiveTraceTriggersForProject("p");
    await service.getActiveGraphTriggersForProject("p");
    expect(triggers.findActiveCalls).toBe(1);

    await service.invalidate("p");
    await service.getActiveTraceTriggersForProject("p");
    expect(triggers.findActiveCalls).toBe(2);
  });

  it("forwards send claims through the automation-owned trigger repository", async () => {
    const triggers = new Triggers();
    const service = makeService(triggers);
    const input = { triggerId: "t", traceId: "trace", projectId: "p" };

    expect(await service.claimSend(input)).toBe(true);
    expect(triggers.claimSendCalls).toEqual([input]);
  });

  it("records scheduled fires through the automation-owned history repository", async () => {
    const history = new Fires();
    const service = makeService(new Triggers(), history);
    const firedAt = new Date("2026-01-01T09:00:00Z");

    await service.recordFire({
      projectId: "p",
      triggerId: "report",
      createdAt: firedAt,
      resolvedAt: firedAt,
    });

    expect(history.create).toHaveBeenCalledWith({
      projectId: "p",
      triggerId: "report",
      traceId: null,
      customGraphId: null,
      createdAt: firedAt,
      resolvedAt: firedAt,
    });
  });

  it("uses a trailing thirty-day window for fire statistics", async () => {
    const history = new Fires();
    history.stats = [
      {
        triggerId: "t",
        lastFiredAt: new Date("2025-12-31T23:00:00Z"),
        recentFireCount: 2,
        currentlyFiring: false,
      },
    ];
    const service = makeService(new Triggers(), history);

    expect(await service.getFireStats({ projectId: "p" })).toEqual(history.stats);
    const input = history.findAllStatsForProject.mock.calls[0]?.[0];
    expect(input?.projectId).toBe("p");
    expect(input?.firesSince).toEqual(new Date("2025-12-02T00:00:00Z"));
  });

  it("selects trigger-scoped or project fire history based on the query", async () => {
    const history = new Fires();
    history.fires = [
      {
        id: "fire",
        triggerId: "t",
        customGraphId: null,
        createdAt: new Date("2025-12-31T00:00:00Z"),
        resolvedAt: null,
      },
    ];
    const service = makeService(new Triggers(), history);

    await service.getRecentFires({ projectId: "p", triggerId: "t", limit: 5 });
    await service.getRecentFires({ projectId: "p", limit: 10 });
    expect(history.findAllRecentByTriggerId).toHaveBeenCalledWith({
      projectId: "p",
      triggerId: "t",
      limit: 5,
    });
    expect(history.findAllRecentForProject).toHaveBeenCalledWith({
      projectId: "p",
      limit: 10,
    });
  });

  it("owns webhook delivery recording, reads, and pruning", async () => {
    const webhookDeliveries = new EmptyWebhookDeliveries();
    webhookDeliveries.findAllRecentByTriggerId.mockResolvedValue([
      {
        id: "row-1",
        triggerId: "t",
        dispatchId: "d1",
        responseStatus: 200,
        latencyMs: 42,
        error: null,
        response: null,
        outcome: "success",
        firedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    webhookDeliveries.pruneExpired.mockResolvedValue(7);
    const service = makeService(new Triggers(), new Fires(), webhookDeliveries);
    const input: WebhookDeliveryInput = {
      projectId: "p",
      triggerId: "t",
      dispatchId: "d1",
      responseStatus: 200,
      latencyMs: 42,
      outcome: "success",
    };

    await service.recordWebhookDelivery(input);
    expect(webhookDeliveries.create).toHaveBeenCalledWith(input);
    expect(
      await service.getRecentWebhookDeliveries({
        projectId: "p",
        triggerId: "t",
        limit: 25,
      }),
    ).toMatchObject([{ dispatchId: "d1", triggerId: "t" }]);
    expect(webhookDeliveries.findAllRecentByTriggerId).toHaveBeenCalledWith({
      projectId: "p",
      triggerId: "t",
      limit: 25,
    });
    expect(await service.pruneWebhookDeliveries()).toBe(7);
  });
});

describe("AutomationService email suppression", () => {
  it("normalizes addresses and applies project-wide rows", async () => {
    const repo = new Suppressions();
    const service = makeService(
      new Triggers(),
      new Fires(),
      new EmptyWebhookDeliveries(),
      ReportScheduleService.create({
        jobs: new Jobs(),
        clock: new Clock(),
        wake: new Wake(),
      }),
      repo,
    );
    await service.suppressEmail({
      projectId: "p",
      email: " Alice@Example.COM ",
      triggerId: null,
    });
    expect(
      await service.filterSuppressed({
        projectId: "p",
        triggerId: "t",
        emails: ["alice@example.com", "bob@example.com"],
      }),
    ).toEqual(["bob@example.com"]);
  });

  it("repairs missing report schedules without reactivating paused rows", async () => {
    const triggers = new Triggers();
    triggers.reportTargets = [
      {
        id: "missing",
        projectId: "p",
        actionParams: {
          source: { kind: "dashboard", dashboardId: "dashboard" },
          schedule: { cron: "0 9 * * *", timezone: "UTC" },
          compareToPrevious: false,
        },
      },
      {
        id: "paused",
        projectId: "p",
        actionParams: {
          source: { kind: "dashboard", dashboardId: "dashboard" },
          schedule: { cron: "0 10 * * *", timezone: "UTC" },
          compareToPrevious: false,
        },
      },
    ];
    const jobs = new Jobs();
    jobs.rows = [
      {
        targetId: "paused",
        nextRunAt: new Date("2026-01-02T10:00:00Z"),
        lastSlot: null,
        active: false,
      },
    ];
    const service = makeService(
      triggers,
      new Fires(),
      new EmptyWebhookDeliveries(),
      ReportScheduleService.create({
        jobs,
        clock: new Clock(),
        wake: new Wake(),
      }),
    );

    expect(await service.reconcileReportSchedules()).toEqual({ repaired: 1 });
    expect(jobs.rows.map((row) => [row.targetId, row.active])).toEqual([
      ["paused", false],
      ["missing", true],
    ]);
  });
});

import type {
  CustomGraph,
  Project,
  Trigger,
} from "@prisma/client";
import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesResult } from "~/server/analytics/types";
import {
  evaluateGraphTrigger,
  type GraphTriggerEvaluationDeps,
} from "../graph-trigger-evaluation.service";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
} from "../repositories/trigger.repository";

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const GRAPH_ID = "graph-1";
const NOW = new Date("2026-06-20T12:00:00Z");

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: TRIGGER_ID,
    projectId: PROJECT_ID,
    name: "My Alert",
    action: TriggerAction.SEND_EMAIL,
    actionParams: {
      threshold: 10,
      operator: "gt",
      timePeriod: 60,
      seriesName: "0/metadata.trace_id/cardinality",
      members: ["a@example.com"],
    },
    filters: {},
    active: true,
    deleted: false,
    alertType: null,
    message: null,
    customGraphId: GRAPH_ID,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Trigger;
}

function makeGraph(overrides: Partial<CustomGraph> = {}): CustomGraph {
  return {
    id: GRAPH_ID,
    projectId: PROJECT_ID,
    name: "Trace count",
    graph: {
      series: [
        {
          name: "Trace count",
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          colorSet: "blueTones",
        },
      ],
      groupBy: undefined,
      groupByKey: undefined,
      timeScale: 60,
    },
    filters: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as CustomGraph;
}

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    name: "Demo",
    slug: "demo",
  } as unknown as Project;
}

function timeseries(value: number | null): TimeseriesResult {
  if (value === null) {
    return { currentPeriod: [], previousPeriod: [] };
  }
  return {
    currentPeriod: [
      { date: "2026-06-20T11:00:00Z", "0/metadata.trace_id/cardinality": value },
    ],
    previousPeriod: [],
  } as unknown as TimeseriesResult;
}

class FakeTriggerSentRepo implements GraphTriggerSentRepository {
  openRows: OpenGraphTriggerSent[] = [];
  createCalls = 0;
  resolveCalls: Array<{ id: string; projectId: string; now: Date }> = [];

  async findOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    return (
      this.openRows.find(
        (r) =>
          r.triggerId === params.triggerId &&
          r.projectId === params.projectId &&
          r.customGraphId === params.customGraphId,
      ) ?? null
    );
  }

  async createOpenForGraphAlert(params: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent> {
    this.createCalls++;
    const row: OpenGraphTriggerSent = {
      id: `sent-${this.openRows.length + 1}`,
      ...params,
    };
    this.openRows.push(row);
    return row;
  }

  async markResolvedById(params: {
    id: string;
    projectId: string;
    now: Date;
  }): Promise<void> {
    this.resolveCalls.push(params);
    this.openRows = this.openRows.filter((r) => r.id !== params.id);
  }
}

interface Harness {
  deps: GraphTriggerEvaluationDeps;
  triggerSent: FakeTriggerSentRepo;
  email: ReturnType<typeof vi.fn>;
  slack: ReturnType<typeof vi.fn>;
  getTimeseries: ReturnType<typeof vi.fn>;
  updateLastRunAt: ReturnType<typeof vi.fn>;
  loadTrigger: ReturnType<typeof vi.fn>;
  loadCustomGraph: ReturnType<typeof vi.fn>;
}

function makeHarness({
  trigger = makeTrigger(),
  graph = makeGraph(),
  project = makeProject(),
  series,
}: {
  trigger?: Trigger | null;
  graph?: CustomGraph | null;
  project?: Project | null;
  series: TimeseriesResult;
}): Harness {
  const email = vi.fn(async () => undefined);
  const slack = vi.fn(async () => undefined);
  const getTimeseries = vi.fn(async () => series);
  const updateLastRunAt = vi.fn(async () => undefined);
  const loadTrigger = vi.fn(async () => trigger);
  const loadCustomGraph = vi.fn(async () => graph);
  const triggerSent = new FakeTriggerSentRepo();

  const deps: GraphTriggerEvaluationDeps = {
    loadTrigger,
    loadCustomGraph,
    loadProject: async () => project,
    getTimeseries,
    triggerSent,
    updateLastRunAt,
    notifier: {
      sendEmail: email,
      sendSlack: slack,
    },
    now: () => NOW,
  };
  return {
    deps,
    triggerSent,
    email,
    slack,
    getTimeseries,
    updateLastRunAt,
    loadTrigger,
    loadCustomGraph,
  };
}

describe("evaluateGraphTrigger", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness({ series: timeseries(15) });
  });

  describe("given a breach with no open TriggerSent", () => {
    it("fires the email notifier and inserts a TriggerSent", async () => {
      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("fired");
      expect(result.value).toBe(15);
      expect(harness.email).toHaveBeenCalledTimes(1);
      expect(harness.slack).not.toHaveBeenCalled();
      expect(harness.triggerSent.createCalls).toBe(1);
      expect(harness.triggerSent.openRows).toHaveLength(1);
      expect(harness.triggerSent.openRows[0]?.customGraphId).toBe(GRAPH_ID);
      expect(harness.updateLastRunAt).toHaveBeenCalledWith({
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
      });
    });

    describe("when action is SEND_SLACK_MESSAGE", () => {
      it("fires the slack notifier instead of email", async () => {
        harness = makeHarness({
          trigger: makeTrigger({ action: TriggerAction.SEND_SLACK_MESSAGE }),
          series: timeseries(15),
        });

        const result = await evaluateGraphTrigger({
          deps: harness.deps,
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          reason: "real-time",
        });

        expect(result.status).toBe("fired");
        expect(harness.slack).toHaveBeenCalledTimes(1);
        expect(harness.email).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a breach with an existing open TriggerSent", () => {
    it("reports already_firing and does not re-notify", async () => {
      harness.triggerSent.openRows.push({
        id: "sent-prior",
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        customGraphId: GRAPH_ID,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("already_firing");
      expect(harness.email).not.toHaveBeenCalled();
      expect(harness.triggerSent.createCalls).toBe(0);
      expect(harness.updateLastRunAt).toHaveBeenCalledTimes(1);
    });

    it("is idempotent across repeated invocations", async () => {
      // First call inserts the TriggerSent.
      await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });
      // Second call within the debounce window sees the open row and
      // does NOT re-notify.
      const second = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(second.status).toBe("already_firing");
      expect(harness.email).toHaveBeenCalledTimes(1);
      expect(harness.triggerSent.createCalls).toBe(1);
    });
  });

  describe("given the threshold no longer breaches with an open TriggerSent", () => {
    it("resolves the open row and reports resolved", async () => {
      harness = makeHarness({ series: timeseries(2) });
      harness.triggerSent.openRows.push({
        id: "sent-prior",
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        customGraphId: GRAPH_ID,
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "heartbeat-resolve",
      });

      expect(result.status).toBe("resolved");
      expect(harness.triggerSent.resolveCalls).toHaveLength(1);
      expect(harness.triggerSent.resolveCalls[0]?.id).toBe("sent-prior");
      expect(harness.email).not.toHaveBeenCalled();
    });
  });

  describe("given no breach and no open TriggerSent", () => {
    it("reports not_breached without firing", async () => {
      harness = makeHarness({ series: timeseries(2) });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("not_breached");
      expect(harness.email).not.toHaveBeenCalled();
      expect(harness.triggerSent.openRows).toHaveLength(0);
    });
  });

  describe("given a no-data trigger with an absent metric", () => {
    it("fires when the heartbeat invokes the evaluator", async () => {
      harness = makeHarness({
        trigger: makeTrigger({
          actionParams: {
            threshold: 1,
            operator: "lt",
            timePeriod: 60,
            seriesName: "0/metadata.trace_id/cardinality",
            members: ["a@example.com"],
          },
        }),
        series: timeseries(null),
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "heartbeat-absence",
      });

      expect(result.status).toBe("fired");
      expect(result.detail).toBe("no-data predicate");
      expect(harness.email).toHaveBeenCalledTimes(1);
      expect(harness.triggerSent.createCalls).toBe(1);
    });
  });

  describe("given an inactive trigger", () => {
    it("skips without calling analytics", async () => {
      harness = makeHarness({
        trigger: makeTrigger({ active: false }),
        series: timeseries(15),
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("skipped");
      expect(result.detail).toBe("trigger inactive");
      expect(harness.getTimeseries).not.toHaveBeenCalled();
    });
  });

  describe("given a missing graph", () => {
    it("skips with a graph-not-found detail", async () => {
      harness = makeHarness({ graph: null, series: timeseries(15) });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("skipped");
      expect(result.detail).toBe("graph not found");
    });
  });

  describe("given a trigger missing actionParams.threshold", () => {
    it("skips without notifying", async () => {
      harness = makeHarness({
        trigger: makeTrigger({
          actionParams: { operator: "gt", timePeriod: 60, seriesName: "0" },
        }),
        series: timeseries(15),
      });

      const result = await evaluateGraphTrigger({
        deps: harness.deps,
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        reason: "real-time",
      });

      expect(result.status).toBe("skipped");
      expect(result.detail).toContain("threshold");
    });
  });
});

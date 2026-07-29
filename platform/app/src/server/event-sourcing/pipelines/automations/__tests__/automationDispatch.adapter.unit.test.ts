import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationDispatchCollaborators } from "../automationDispatch.adapter";
import { buildAutomationDispatchPorts } from "../automationDispatch.adapter";

const {
  decideGraphTriggerHeartbeatMock,
  evaluateGraphTriggerMock,
  consumeEmailCapSlotMock,
} = vi.hoisted(() => ({
  decideGraphTriggerHeartbeatMock: vi.fn().mockResolvedValue([]),
  evaluateGraphTriggerMock: vi.fn().mockResolvedValue(undefined),
  consumeEmailCapSlotMock: vi
    .fn()
    .mockResolvedValue({ allowed: true, count: 1 }),
}));

vi.mock(
  "~/server/app-layer/automations/graph-trigger-evaluation.service",
  () => ({ evaluateGraphTrigger: evaluateGraphTriggerMock }),
);

vi.mock("~/server/app-layer/automations/graph-trigger-heartbeat", () => ({
  decideGraphTriggerHeartbeat: decideGraphTriggerHeartbeatMock,
}));

vi.mock("~/server/app-layer/automations/dispatch/emailCaps", () => ({
  consumeEmailCapSlot: consumeEmailCapSlotMock,
  consumeTenantEmailCapSlot: vi
    .fn()
    .mockResolvedValue({ allowed: true, count: 1 }),
}));

const collaborators = () => {
  const spies = {
    filterSuppressed: vi.fn(async ({ emails }: { emails: string[] }) => emails),
    pruneExpired: vi.fn().mockResolvedValue(7),
    record: vi.fn().mockResolvedValue(undefined),
    traceById: vi.fn().mockResolvedValue({ trace_id: "trace-1" }),
    enqueueTracesForAnnotators: vi.fn().mockResolvedValue(undefined),
    createRecordsForDatasetId: vi.fn().mockResolvedValue(undefined),
    deriveEvents: vi.fn().mockResolvedValue([]),
    updateLastRunAt: vi.fn().mockResolvedValue(undefined),
    getTimeseries: vi.fn().mockResolvedValue({ currentPeriod: [] }),
  };
  const heartbeat = {
    deps: { heartbeatDeps: true },
    sources: { heartbeatSources: true },
  };
  const collaborators = {
    baseHost: "https://app.example.com",
    emailHourlyCap: 100,
    tenantDailyCap: 1_000,
    triggers: { updateLastRunAt: spies.updateLastRunAt },
    projects: {},
    evaluationRuns: {},
    analytics: { getTimeseries: spies.getTimeseries },
    emailSuppressions: { filterSuppressed: spies.filterSuppressed },
    customGraphs: {},
    webhookDeliveries: {
      record: spies.record,
      pruneExpired: spies.pruneExpired,
    },
    traceReadDerivation: { deriveEvents: spies.deriveEvents },
    traceReads: { getById: spies.traceById },
    annotations: {
      enqueueTracesForAnnotators: spies.enqueueTracesForAnnotators,
    },
    datasets: { createRecordsForDatasetId: spies.createRecordsForDatasetId },
    graphTriggerSent: {},
    traceSummaryStore: {},
    heartbeat,
  } as unknown as AutomationDispatchCollaborators;

  return { collaborators, spies, heartbeat };
};

describe("automation dispatch adapter", () => {
  // The mocks are hoisted, so their call history outlives each test. Clearing
  // it (not resetting it — `mockResolvedValue` defaults survive `mockClear`)
  // keeps every assertion about the call THIS test made.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the settlement ports are adapted", () => {
    it("forwards each side effect to its collaborator", async () => {
      const { collaborators: c, spies } = collaborators();
      const { settlementDeps } = buildAutomationDispatchPorts(c);

      await settlementDeps.filterSuppressedEmails({
        projectId: "project-1",
        triggerId: "trigger-1",
        emails: ["ops@example.com"],
      });
      expect(spies.filterSuppressed).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerId: "trigger-1",
        emails: ["ops@example.com"],
      });

      await settlementDeps.traceById("project-1", "trace-1");
      expect(spies.traceById).toHaveBeenCalledWith({
        projectId: "project-1",
        traceId: "trace-1",
      });

      await settlementDeps.addToAnnotationQueue({
        traceIds: ["trace-1"],
        projectId: "project-1",
        annotators: ["queue-q1"],
        userId: "user-1",
      });
      expect(spies.enqueueTracesForAnnotators).toHaveBeenCalledWith({
        traceIds: ["trace-1"],
        projectId: "project-1",
        annotators: ["queue-q1"],
        userId: "user-1",
      });

      await settlementDeps.addToDataset({
        datasetId: "dataset-1",
        projectId: "project-1",
        datasetRecords: [{ id: "record-1" }],
      });
      expect(spies.createRecordsForDatasetId).toHaveBeenCalledWith({
        datasetId: "dataset-1",
        projectId: "project-1",
        datasetRecords: [{ id: "record-1" }],
      });
    });

    it("binds the configured hourly cap onto the cap consumer", async () => {
      const { collaborators: c } = collaborators();
      const { settlementDeps } = buildAutomationDispatchPorts(c);

      const now = new Date("2026-07-18T12:00:00.000Z");
      await settlementDeps.consumeEmailCapSlot({
        projectId: "project-1",
        triggerId: "trigger-1",
        now,
        dedupKey: "digest-1",
      });

      expect(consumeEmailCapSlotMock).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerId: "trigger-1",
        now,
        cap: 100,
        dedupKey: "digest-1",
      });
    });
  });

  describe("when the graph-alert ports are adapted", () => {
    it("hands the evaluator its own port bundle", async () => {
      const { collaborators: c, spies } = collaborators();
      const ports = buildAutomationDispatchPorts(c);

      await ports.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "heartbeat-absence",
      });

      expect(evaluateGraphTriggerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "heartbeat-absence",
          deps: expect.objectContaining({
            baseHost: "https://app.example.com",
            triggerSent: c.graphTriggerSent,
          }),
        }),
      );

      const { deps } = evaluateGraphTriggerMock.mock.calls.at(-1)![0];
      await deps.updateLastRunAt({
        triggerId: "trigger-1",
        projectId: "project-1",
      });
      expect(spies.updateLastRunAt).toHaveBeenCalledWith(
        "trigger-1",
        "project-1",
      );
    });

    /**
     * The timeseries read used to be resolved through `getAnalyticsService()`
     * inside the adapter, which made it the one collaborator no test could
     * substitute. It arrives as a collaborator now, so this asserts the port
     * delegates to whatever the composition root supplied.
     */
    it("reads timeseries through the injected analytics collaborator", async () => {
      const { collaborators: c, spies } = collaborators();
      const ports = buildAutomationDispatchPorts(c);

      await ports.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "heartbeat-absence",
      });

      const { deps } = evaluateGraphTriggerMock.mock.calls.at(-1)![0];
      const input = { projectId: "project-1", series: [] };
      await deps.getTimeseries(input);

      expect(spies.getTimeseries).toHaveBeenCalledWith(input);
    });
  });

  describe("when the scheduled process-manager ports are adapted", () => {
    it("passes the heartbeat bundle straight through", async () => {
      const { collaborators: c, heartbeat } = collaborators();
      const ports = buildAutomationDispatchPorts(c);

      const now = new Date("2026-07-18T12:00:00.000Z");
      await ports.decideSweepCandidates({ now });

      expect(decideGraphTriggerHeartbeatMock).toHaveBeenCalledWith({
        deps: heartbeat.deps,
        sources: heartbeat.sources,
        now,
      });
    });

    it("returns the pruned row count from the delivery-log service", async () => {
      const { collaborators: c, spies } = collaborators();
      const ports = buildAutomationDispatchPorts(c);

      await expect(ports.pruneWebhookDeliveries()).resolves.toBe(7);
      expect(spies.pruneExpired).toHaveBeenCalledTimes(1);
    });
  });
});

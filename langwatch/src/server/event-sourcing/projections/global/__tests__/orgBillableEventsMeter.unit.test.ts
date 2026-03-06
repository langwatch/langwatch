/**
 * Unit tests for the billable events meter projection and store.
 *
 * Mocks boundaries: ClickHouse client, Prisma (org lookup), logger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockClickHouseInsert,
  mockGetClickHouseClient,
  mockPrisma,
  mockLoggerWarn,
  mockLoggerDebug,
  createMockLogger,
} = vi.hoisted(() => {
  const mockClickHouseInsert = vi.fn();
  const mockGetClickHouseClient = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockLoggerDebug = vi.fn();

  const createMockLogger = () => ({
    info: vi.fn(),
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  const mockPrisma = {
    project: { findUnique: vi.fn() },
  };

  return {
    mockClickHouseInsert,
    mockGetClickHouseClient,
    mockPrisma,
    mockLoggerWarn,
    mockLoggerDebug,
    createMockLogger,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: mockGetClickHouseClient,
}));

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyContext = {
  aggregateId: "test-aggregate",
  tenantId: "test-tenant",
} as ProjectionStoreContext;

function makeSpanEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0), // 2026-02-15
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: "2025-12-14",
    data: {},
    metadata: { traceId: "trace-abc", spanId: "span-123" },
    ...overrides,
  } as Event;
}

function makeEvaluationEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-2",
    aggregateId: "eval-1",
    aggregateType: "evaluation",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.evaluation.started",
    version: "2025-01-14",
    data: { evaluationId: "eval-xyz" },
    metadata: {},
    ...overrides,
  } as Event;
}

function makeExperimentRunEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-3",
    aggregateId: "run-1",
    aggregateType: "experiment_run",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.experiment_run.started",
    version: "2025-02-01",
    data: { runId: "run-456" },
    metadata: {},
    ...overrides,
  } as Event;
}

function makeEvaluationScheduledEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-4",
    aggregateId: "eval-2",
    aggregateType: "evaluation",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.evaluation.scheduled",
    version: "2025-01-14",
    data: { evaluationId: "eval-sched-xyz" },
    metadata: {},
    ...overrides,
  } as Event;
}

function makeExperimentTargetResultEvent(
  overrides: Partial<Event> = {},
): Event {
  return {
    id: "evt-5",
    aggregateId: "run-2",
    aggregateType: "experiment_run",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.experiment_run.target_result",
    version: "2025-02-01",
    data: {
      runId: "run-789",
      experimentId: "exp-abc",
      index: 3,
      targetId: "tgt-x",
      entry: {},
    },
    metadata: {},
    ...overrides,
  } as Event;
}

function makeExperimentEvaluatorResultEvent(
  overrides: Partial<Event> = {},
): Event {
  return {
    id: "evt-6",
    aggregateId: "run-3",
    aggregateType: "experiment_run",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.experiment_run.evaluator_result",
    version: "2025-02-01",
    data: {
      runId: "run-789",
      experimentId: "exp-abc",
      index: 3,
      targetId: "tgt-x",
      evaluatorId: "eval-e1",
      status: "processed",
    },
    metadata: {},
    ...overrides,
  } as Event;
}

function makeSimulationRunStartedEvent(
  overrides: Partial<Event> = {},
): Event {
  return {
    id: "evt-7",
    aggregateId: "sim-1",
    aggregateType: "simulation_run",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.simulation_run.started",
    version: "2026-02-01",
    data: {
      scenarioRunId: "run-sim-1",
      scenarioId: "scen-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
    metadata: {},
    ...overrides,
  } as Event;
}

function makeSimulationMessageSnapshotEvent(
  overrides: Partial<Event> = {},
): Event {
  return {
    id: "evt-8",
    aggregateId: "sim-2",
    aggregateType: "simulation_run",
    tenantId: "proj-1",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    occurredAt: Date.now(),
    type: "lw.simulation_run.message_snapshot",
    version: "2026-02-01",
    data: {
      scenarioRunId: "run-sim-2",
      messages: [],
      traceIds: [],
    },
    metadata: {},
    ...overrides,
  } as Event;
}

// ---------------------------------------------------------------------------
// Tests: MapProjection (pure map function)
// ---------------------------------------------------------------------------

describe("orgBillableEventsMeterProjection.map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("given span_received event", () => {
    it("extracts traceId:spanId as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(makeSpanEvent());

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "trace-abc:span-123",
          eventType: "lw.obs.trace.span_received",
          tenantId: "proj-1",
          eventId: "evt-1",
        }),
      );
    });
  });

  describe("given evaluation.started event", () => {
    it("extracts evaluationId as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeEvaluationEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "eval-xyz",
          eventType: "lw.evaluation.started",
        }),
      );
    });
  });

  describe("given experiment_run.started event", () => {
    it("extracts runId as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeExperimentRunEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "run-456",
          eventType: "lw.experiment_run.started",
        }),
      );
    });
  });

  describe("given span event without metadata traceId/spanId", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeSpanEvent({ metadata: {} }),
      );

      expect(result).toBeNull();
    });
  });

  describe("given evaluation.scheduled event", () => {
    it("extracts evaluationId as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeEvaluationScheduledEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "eval-sched-xyz",
          eventType: "lw.evaluation.scheduled",
        }),
      );
    });
  });

  describe("given evaluation.scheduled event without evaluationId", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeEvaluationScheduledEvent({ data: {} }),
      );

      expect(result).toBeNull();
    });
  });

  describe("given experiment_run.target_result event", () => {
    it("extracts composite key as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeExperimentTargetResultEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "exp-abc:run-789:target:3:tgt-x",
          eventType: "lw.experiment_run.target_result",
        }),
      );
    });
  });

  describe("given experiment_run.target_result event without required fields", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeExperimentTargetResultEvent({ data: { runId: "run-789" } }),
      );

      expect(result).toBeNull();
    });
  });

  describe("given experiment_run.evaluator_result event", () => {
    it("extracts composite key as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeExperimentEvaluatorResultEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "exp-abc:run-789:evaluator:3:tgt-x:eval-e1",
          eventType: "lw.experiment_run.evaluator_result",
        }),
      );
    });
  });

  describe("given experiment_run.evaluator_result event without required fields", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeExperimentEvaluatorResultEvent({ data: { runId: "run-789" } }),
      );

      expect(result).toBeNull();
    });
  });

  describe("given simulation_run.started event", () => {
    it("extracts scenarioRunId as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeSimulationRunStartedEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "run-sim-1",
          eventType: "lw.simulation_run.started",
        }),
      );
    });
  });

  describe("given simulation_run.started event without scenarioRunId", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeSimulationRunStartedEvent({ data: {} }),
      );

      expect(result).toBeNull();
    });
  });

  describe("given simulation_run.message_snapshot event", () => {
    it("extracts scenarioRunId as dedup key", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeSimulationMessageSnapshotEvent(),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "run-sim-2",
          eventType: "lw.simulation_run.message_snapshot",
        }),
      );
    });
  });

  describe("given simulation_run.message_snapshot event without scenarioRunId", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeSimulationMessageSnapshotEvent({ data: {} }),
      );

      expect(result).toBeNull();
    });
  });

  describe("given unknown event type", () => {
    it("returns null", async () => {
      const { orgBillableEventsMeterProjection } = await import(
        "../orgBillableEventsMeter.mapProjection"
      );

      const result = orgBillableEventsMeterProjection.map(
        makeSpanEvent({ type: "lw.unknown.event" as never }),
      );

      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: AppendStore
// ---------------------------------------------------------------------------

describe("orgBillableEventsMeterStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("given ClickHouse client is configured and org exists", () => {
    it("resolves organizationId and inserts into ClickHouse", async () => {
      mockGetClickHouseClient.mockReturnValue({
        insert: mockClickHouseInsert,
      });
      mockClickHouseInsert.mockResolvedValue(undefined);
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );
      // Clear org cache to ensure fresh lookup
      const { clearOrgCache } = await import("~/server/organizations/resolveOrganizationId");
      clearOrgCache();

      await orgBillableEventsMeterStore.append(
        {
          organizationId: "",
          tenantId: "proj-1",
          eventId: "evt-1",

          eventType: "lw.obs.trace.span_received",
          deduplicationKey: "trace-abc:span-123",
          eventTimestamp: 1739613600000,
        },
        dummyContext,
      );

      expect(mockClickHouseInsert).toHaveBeenCalledWith({
        table: "billable_events",
        values: [
          expect.objectContaining({
            OrganizationId: "org-1",
            TenantId: "proj-1",
            EventId: "evt-1",
            EventType: "lw.obs.trace.span_received",
            DeduplicationKey: "trace-abc:span-123",
          }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    });
  });

  describe("given ClickHouse client is null (not configured)", () => {
    it("skips gracefully", async () => {
      mockGetClickHouseClient.mockReturnValue(null);

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );

      await orgBillableEventsMeterStore.append(
        {
          organizationId: "",
          tenantId: "proj-1",
          eventId: "evt-1",

          eventType: "lw.obs.trace.span_received",
          deduplicationKey: "trace-abc:span-123",
          eventTimestamp: 1739613600000,
        },
        dummyContext,
      );

      expect(mockClickHouseInsert).not.toHaveBeenCalled();
      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "ClickHouse not configured, skipping billable event insert",
      );
    });
  });

  describe("given ClickHouse insert fails (transient error)", () => {
    it("throws for BullMQ retry", async () => {
      const insertError = new Error("ClickHouse connection timeout");
      mockGetClickHouseClient.mockReturnValue({
        insert: mockClickHouseInsert,
      });
      mockClickHouseInsert.mockRejectedValue(insertError);
      mockPrisma.project.findUnique.mockResolvedValue({
        team: { organizationId: "org-1" },
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );
      const { clearOrgCache } = await import("~/server/organizations/resolveOrganizationId");
      clearOrgCache();

      await expect(
        orgBillableEventsMeterStore.append(
          {
            organizationId: "",
            tenantId: "proj-1",
            eventId: "evt-1",
  
            eventType: "lw.obs.trace.span_received",
            deduplicationKey: "trace-abc:span-123",
            eventTimestamp: 1739613600000,
          },
          dummyContext,
        ),
      ).rejects.toThrow("ClickHouse connection timeout");
    });
  });

  describe("given orphan project (org not found)", () => {
    it("skips gracefully with warn log", async () => {
      mockGetClickHouseClient.mockReturnValue({
        insert: mockClickHouseInsert,
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        team: null,
      });

      const { orgBillableEventsMeterStore } = await import(
        "../orgBillableEventsMeter.store"
      );
      const { clearOrgCache } = await import("~/server/organizations/resolveOrganizationId");
      clearOrgCache();

      await orgBillableEventsMeterStore.append(
        {
          organizationId: "",
          tenantId: "orphan-proj",
          eventId: "evt-1",

          eventType: "lw.obs.trace.span_received",
          deduplicationKey: "trace-abc:span-123",
          eventTimestamp: 1739613600000,
        },
        dummyContext,
      );

      expect(mockClickHouseInsert).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { projectId: "orphan-proj" },
        expect.stringContaining("orphan project detected"),
      );
    });
  });
});

import type { ClickHouseClient } from "@langwatch/clickhouse";
import { UndecodableStateError } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { simulationRun } from "../aggregate";
import { createSimulationProcessingPipeline } from "../index";
import { simulationRunMessagesTable, simulationRunsTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */

const QUEUED_INPUT = {
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  batchTotal: 4,
  occurredAt: 1,
};

/** Encodes a stored run row exactly as a real read returns it. */
function storedRow(version: string): unknown[] {
  const state = simulationRun.apply(
    simulationRun.init(),
    simulationRun.events.queued(QUEUED_INPUT),
  );
  const now = new Date("2026-07-30T00:00:00.000Z");
  const values: Record<string, unknown> = {
    ProjectionId: state.scenarioRunId,
    TenantId: "tenant-1",
    ScenarioRunId: state.scenarioRunId,
    ScenarioId: state.scenarioId,
    BatchRunId: state.batchRunId,
    ScenarioSetId: state.scenarioSetId,
    Version: version,
    Status: state.status,
    Name: state.name,
    Description: state.description,
    Metadata: state.metadata,
    TraceIds: state.traceIds,
    Verdict: state.verdict,
    Reasoning: state.reasoning,
    MetCriteria: state.metCriteria,
    UnmetCriteria: state.unmetCriteria,
    Error: state.error,
    DurationMs: state.durationMs === null ? null : BigInt(state.durationMs),
    TotalCost: state.totalCost,
    RoleCosts: new Map(Object.entries(state.roleCosts)),
    RoleLatencies: new Map(Object.entries(state.roleLatencies)),
    StartedAt: new Date(state.startedAt ?? now.getTime()),
    QueuedAt: state.queuedAt === null ? null : new Date(state.queuedAt),
    CreatedAt: now,
    UpdatedAt: now,
    FinishedAt: state.finishedAt === null ? null : new Date(state.finishedAt),
    ArchivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
    CancellationRequestedAt:
      state.cancellationRequestedAt === null
        ? null
        : new Date(state.cancellationRequestedAt),
    LastEventOccurredAt: now,
    BatchTotal: state.batchTotal,
    _retention_days: 308,
  };
  return simulationRunsTable.columnNames.map((name) =>
    simulationRunsTable.columns[name].encode(values[name] as never),
  );
}

function fakeClient(
  overrides: Partial<ClickHouseClient> = {},
): ClickHouseClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    stream: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function columnValue(
  insert: ReturnType<typeof vi.fn>,
  table: typeof simulationRunsTable | typeof simulationRunMessagesTable,
  column: string,
  call = 0,
  row = 0,
): unknown {
  const rows = insert.mock.calls[call]![0]!.rows as unknown[][];
  return rows[row]![table.columnNames.indexOf(column as never)];
}

describe("createSimulationProcessingPipeline", () => {
  describe("given a fresh aggregate with no stored state", () => {
    it("applies queueRun and writes the resulting run row", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({ insert }),
      });

      const outcome = await pipeline.applySimulationRunCommand({
        tenantId: "tenant-1",
        scenarioRunId: "run-1",
        command: "queueRun",
        input: QUEUED_INPUT,
      });

      expect(outcome).toEqual({ events: 1 });
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "simulation_runs",
          tenantId: "tenant-1",
          columns: simulationRunsTable.columnNames,
          target: { kind: "replacing" },
        }),
      );
      expect(columnValue(insert, simulationRunsTable, "Status")).toBe("QUEUED");
      expect(columnValue(insert, simulationRunsTable, "BatchTotal")).toBe(4);
    });

    it("rejects an input that fails the command's own schema", async () => {
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient(),
      });

      await expect(
        pipeline.applySimulationRunCommand({
          tenantId: "tenant-1",
          scenarioRunId: "run-1",
          command: "queueRun",
          input: { scenarioRunId: "run-1", occurredAt: 1 },
        }),
      ).rejects.toThrow();
    });
  });

  describe("given a stored row this build cannot decode", () => {
    it("fails rather than folding the command onto genesis state", async () => {
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({
          query: vi
            .fn()
            .mockResolvedValue({ rows: [storedRow("some-other-hash")] }),
        }),
      });

      await expect(
        pipeline.applySimulationRunCommand({
          tenantId: "tenant-1",
          scenarioRunId: "run-1",
          command: "startRun",
          input: {
            scenarioRunId: "run-1",
            scenarioId: "scenario-1",
            batchRunId: "batch-1",
            scenarioSetId: "set-1",
            occurredAt: 1,
          },
        }),
      ).rejects.toBeInstanceOf(UndecodableStateError);
    });
  });

  describe("given a stored row this build wrote", () => {
    it("folds the command onto the stored state rather than genesis", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({
          query: vi.fn().mockResolvedValue({
            rows: [storedRow(simulationRun.stateVersion)],
          }),
          insert,
        }),
      });

      await pipeline.applySimulationRunCommand({
        tenantId: "tenant-1",
        scenarioRunId: "run-1",
        command: "cancelRun",
        input: { scenarioRunId: "run-1", occurredAt: 7 },
      });

      expect(
        columnValue(insert, simulationRunsTable, "CancellationRequestedAt"),
      ).not.toBeNull();
      // The stored batch total survives a command that never mentions it.
      expect(columnValue(insert, simulationRunsTable, "BatchTotal")).toBe(4);
    });

    it("reads with read-your-writes consistency", async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({ query }),
      });

      await pipeline.applySimulationRunCommand({
        tenantId: "tenant-1",
        scenarioRunId: "run-1",
        command: "cancelRun",
        input: { scenarioRunId: "run-1", occurredAt: 1 },
      });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            select_sequential_consistency: 1,
          }),
        }),
      );
    });
  });

  describe("given a delivery of message-bearing events", () => {
    it("writes one row per message in a single insert", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({ insert }),
      });

      const outcome = await pipeline.storeMessages({
        tenantId: "tenant-1",
        events: [
          simulationRun.events.messageSnapshot({
            scenarioRunId: "run-1",
            messages: [
              { id: "m1", role: "user", content: "hello" },
              { id: "m2", role: "assistant", content: "hi" },
            ],
            traceIds: [],
            occurredAt: 10,
          }),
          simulationRun.events.textMessageEnd({
            scenarioRunId: "run-1",
            messageId: "m3",
            role: "assistant",
            content: "bye",
            messageIndex: 2,
            occurredAt: 20,
          }),
        ],
      });

      expect(outcome).toEqual({ written: 3 });
      expect(insert).toHaveBeenCalledOnce();
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "simulation_run_messages",
          columns: simulationRunMessagesTable.columnNames,
          target: { kind: "replacing" },
        }),
      );
      expect(
        columnValue(insert, simulationRunMessagesTable, "MessageId", 0, 2),
      ).toBe("m3");
      expect(
        columnValue(insert, simulationRunMessagesTable, "TenantId", 0, 0),
      ).toBe("tenant-1");
    });

    it("writes nothing for events that carry no message content", async () => {
      const insert = vi.fn().mockResolvedValue(undefined);
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({ insert }),
      });

      const outcome = await pipeline.storeMessages({
        tenantId: "tenant-1",
        events: [
          simulationRun.events.textMessageStart({
            scenarioRunId: "run-1",
            messageId: "m1",
            role: "assistant",
            messageIndex: 0,
            occurredAt: 1,
          }),
        ],
      });

      expect(outcome).toEqual({ written: 0 });
      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe("given the durable store has not yet acknowledged the write", () => {
    /** @scenario "Applying a command does not resolve before the run's state is durable" */
    it("does not resolve the command's promise before the insert resolves", async () => {
      let resolveInsert: (() => void) | undefined;
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({
          insert: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveInsert = resolve;
              }),
          ),
        }),
      });

      let settled = false;
      const applying = pipeline
        .applySimulationRunCommand({
          tenantId: "tenant-1",
          scenarioRunId: "run-1",
          command: "cancelRun",
          input: { scenarioRunId: "run-1", occurredAt: 1 },
        })
        .then(() => {
          settled = true;
        });

      // A graceful shutdown awaiting this call must never observe "finished"
      // before the row actually landed.
      await vi.waitFor(() => expect(resolveInsert).toBeDefined());
      expect(settled).toBe(false);

      resolveInsert?.();
      await applying;
      expect(settled).toBe(true);
    });
  });

  describe("given the durable store's write fails", () => {
    /** @scenario "A failed durable write is not swallowed" */
    it("rejects with the store's own failure rather than reporting success", async () => {
      const failure = new Error("clickhouse said no");
      const pipeline = createSimulationProcessingPipeline({
        client: fakeClient({ insert: vi.fn().mockRejectedValue(failure) }),
      });

      await expect(
        pipeline.applySimulationRunCommand({
          tenantId: "tenant-1",
          scenarioRunId: "run-1",
          command: "cancelRun",
          input: { scenarioRunId: "run-1", occurredAt: 1 },
        }),
      ).rejects.toThrow(failure);
    });
  });
});

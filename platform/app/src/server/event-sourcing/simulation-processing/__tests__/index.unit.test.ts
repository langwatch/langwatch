import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type HandlerContext,
  parseGroupKey,
  UndecodableStateError,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  createSimulationProcessingPipeline,
  renderSimulationRunFoldGroupKey,
  simulationRunFoldGroupKey,
} from "../index";
import type { MetricsRecordedData, RunQueuedData } from "../schema";
import { initSimulationRunState } from "../schema";
import {
  applyMetricsRecorded,
  applyQueued,
} from "../simulationRunState.projection";
import { simulationRunMessagesTable, simulationRunsTable } from "../table";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */

const ctx: HandlerContext = { now: Date.now(), tenantId: "tenant-1" };

const QUEUED_INPUT: RunQueuedData = {
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  batchTotal: 4,
  occurredAt: 1,
};

/** Encodes a stored run row exactly as a real read returns it. */
function storedRunRow(args: {
  readonly input: RunQueuedData;
  readonly version: string;
  readonly metrics?: MetricsRecordedData;
}): unknown[] {
  let state = applyQueued(initSimulationRunState(), args.input);
  if (args.metrics) state = applyMetricsRecorded(state, args.metrics);
  const now = new Date("2026-07-30T00:00:00.000Z");
  const values: Record<string, unknown> = {
    ProjectionId: state.scenarioRunId,
    TenantId: "tenant-1",
    ScenarioRunId: state.scenarioRunId,
    ScenarioId: state.scenarioId,
    BatchRunId: state.batchRunId,
    ScenarioSetId: state.scenarioSetId,
    Version: args.version,
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
    MetricsAsOf:
      state.metricsAsOf === null ? null : new Date(state.metricsAsOf),
    StartedAt: new Date(state.startedAt ?? now.getTime()),
    QueuedAt: state.queuedAt === null ? null : new Date(state.queuedAt),
    CreatedAt: new Date(state.createdAt),
    UpdatedAt: now,
    FinishedAt: state.finishedAt === null ? null : new Date(state.finishedAt),
    ArchivedAt: state.archivedAt === null ? null : new Date(state.archivedAt),
    CancellationRequestedAt:
      state.cancellationRequestedAt === null
        ? null
        : new Date(state.cancellationRequestedAt),
    LastEventOccurredAt: new Date(state.lastEventOccurredAt),
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

describe("the built simulation-processing pipeline", () => {
  it("names itself 'simulation_run', matching the persisted AggregateType already in event_log", () => {
    const built = createSimulationProcessingPipeline({ client: fakeClient() });
    expect(built.name).toBe("simulation_run");
  });

  it("derives the dotted type strings already persisted in event_log", () => {
    const built = createSimulationProcessingPipeline({ client: fakeClient() });
    expect([...built.eventTypes].sort()).toEqual(
      [
        "lw.simulation_run.queued",
        "lw.simulation_run.started",
        "lw.simulation_run.message_snapshot",
        "lw.simulation_run.text_message_start",
        "lw.simulation_run.text_message_end",
        "lw.simulation_run.finished",
        "lw.simulation_run.metrics_recorded",
        "lw.simulation_run.cancel_requested",
        "lw.simulation_run.deleted",
      ].sort(),
    );
  });

  it("pins the fold's stamp rather than deriving it from the state schema's own hash", () => {
    const built = createSimulationProcessingPipeline({ client: fakeClient() });
    // Rows already exist in production under the pinned stamp (ADR-105 decision
    // 9); if the pin were ever dropped this would start failing, because the
    // stamp would collapse to the freshly derived hash.
    expect(built.folds.simulationRunState!.stateVersion).not.toBe(
      built.folds.simulationRunState!.schemaHash,
    );
  });

  it("subscribes the messages map to the two events that carry message content", () => {
    const built = createSimulationProcessingPipeline({ client: fakeClient() });
    expect([...built.maps.simulationRunMessages!.eventTypes].sort()).toEqual([
      "lw.simulation_run.message_snapshot",
      "lw.simulation_run.text_message_end",
    ]);
  });
});

describe("given a fresh aggregate with no stored state", () => {
  it("applies queueRun and writes the resulting run row", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient({ insert }),
    });

    const emitted = await built.commands.queueRun!.handle(QUEUED_INPUT, ctx);
    const outcome = await built.folds.simulationRunState!.apply({
      key: "run-1",
      tenantId: "tenant-1",
      events: emitted,
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
    const built = createSimulationProcessingPipeline({ client: fakeClient() });

    expect(() =>
      built.commands.queueRun!.input.parse({
        scenarioRunId: "run-1",
        occurredAt: 1,
      }),
    ).toThrow();
  });
});

describe("given a stored row this build cannot decode", () => {
  it("fails rather than folding the command onto genesis state", async () => {
    const built = createSimulationProcessingPipeline({
      client: fakeClient({
        query: vi.fn().mockResolvedValue({
          rows: [
            storedRunRow({ input: QUEUED_INPUT, version: "some-other-hash" }),
          ],
        }),
      }),
    });

    const emitted = await built.commands.startRun!.handle(
      {
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        occurredAt: 1,
      },
      ctx,
    );

    await expect(
      built.folds.simulationRunState!.apply({
        key: "run-1",
        tenantId: "tenant-1",
        events: emitted,
      }),
    ).rejects.toBeInstanceOf(UndecodableStateError);
  });
});

describe("given a stored row this build wrote", () => {
  it("folds the command onto the stored state rather than genesis", async () => {
    const version = createSimulationProcessingPipeline({ client: fakeClient() })
      .folds.simulationRunState!.stateVersion;
    const insert = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient({
        query: vi.fn().mockResolvedValue({
          rows: [storedRunRow({ input: QUEUED_INPUT, version })],
        }),
        insert,
      }),
    });

    const emitted = await built.commands.cancelRun!.handle(
      { scenarioRunId: "run-1", occurredAt: 7 },
      ctx,
    );
    await built.folds.simulationRunState!.apply({
      key: "run-1",
      tenantId: "tenant-1",
      events: emitted,
    });

    expect(
      columnValue(insert, simulationRunsTable, "CancellationRequestedAt"),
    ).not.toBeNull();
    // The stored batch total survives a command that never mentions it.
    expect(columnValue(insert, simulationRunsTable, "BatchTotal")).toBe(4);
  });

  it("reads with read-your-writes consistency", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const built = createSimulationProcessingPipeline({
      client: fakeClient({ query }),
    });

    const emitted = await built.commands.cancelRun!.handle(
      { scenarioRunId: "run-1", occurredAt: 1 },
      ctx,
    );
    await built.folds.simulationRunState!.apply({
      key: "run-1",
      tenantId: "tenant-1",
      events: emitted,
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ select_sequential_consistency: 1 }),
      }),
    );
  });
});

describe("given an event of a type this build was not built to handle", () => {
  /** @scenario A run measured under a retired event type keeps its cost on replay */
  it("keeps the stored metrics unchanged rather than resetting them to genesis", async () => {
    const version = createSimulationProcessingPipeline({ client: fakeClient() })
      .folds.simulationRunState!.stateVersion;
    const insert = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient({
        query: vi.fn().mockResolvedValue({
          rows: [
            storedRunRow({
              input: QUEUED_INPUT,
              version,
              metrics: {
                scenarioRunId: "run-1",
                traceIds: ["trace-1"],
                totalCost: 1.5,
                roleCosts: { agent: [1.5] },
                roleLatencies: { agent: [200] },
                occurredAt: 100,
              },
            }),
          ],
        }),
        insert,
      }),
    });

    await built.folds.simulationRunState!.apply({
      key: "run-1",
      tenantId: "tenant-1",
      events: [
        {
          type: "lw.simulation_run.metrics_computed",
          data: {
            scenarioRunId: "run-1",
            traceId: "t",
            totalCost: 0,
            roleCosts: {},
            roleLatencies: {},
          },
        },
      ],
    });

    const totalCost = simulationRunsTable.columns.TotalCost.decode(
      columnValue(insert, simulationRunsTable, "TotalCost") as never,
    );
    expect(totalCost).toBe(1.5);
  });
});

describe("given a delivery of message-bearing events", () => {
  it("writes one row per message in a single insert", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient({ insert }),
    });

    const outcome = await built.maps.simulationRunMessages!.apply({
      tenantId: "tenant-1",
      events: [
        {
          type: "lw.simulation_run.message_snapshot",
          data: {
            scenarioRunId: "run-1",
            messages: [
              { id: "m1", role: "user", content: "hello" },
              { id: "m2", role: "assistant", content: "hi" },
            ],
            traceIds: [],
            occurredAt: 10,
          },
        },
        {
          type: "lw.simulation_run.text_message_end",
          data: {
            scenarioRunId: "run-1",
            messageId: "m3",
            role: "assistant",
            content: "bye",
            messageIndex: 2,
            occurredAt: 20,
          },
        },
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

  /** @scenario A message that has only started carries no transcript row yet */
  it("writes nothing for events that carry no message content", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient({ insert }),
    });

    const outcome = await built.maps.simulationRunMessages!.apply({
      tenantId: "tenant-1",
      events: [
        {
          type: "lw.simulation_run.text_message_start",
          data: {
            scenarioRunId: "run-1",
            messageId: "m1",
            role: "assistant",
            messageIndex: 0,
            occurredAt: 1,
          },
        },
      ],
    });

    expect(outcome).toEqual({ written: 0 });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("given the durable store has not yet acknowledged the write", () => {
  /** @scenario Applying a command does not resolve before the run's state is durable */
  it("does not resolve the command's promise before the insert resolves", async () => {
    let resolveInsert: (() => void) | undefined;
    const built = createSimulationProcessingPipeline({
      client: fakeClient({
        insert: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveInsert = resolve;
            }),
        ),
      }),
    });

    const emitted = await built.commands.cancelRun!.handle(
      { scenarioRunId: "run-1", occurredAt: 1 },
      ctx,
    );

    let settled = false;
    const applying = built.folds
      .simulationRunState!.apply({
        key: "run-1",
        tenantId: "tenant-1",
        events: emitted,
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
  /** @scenario A failed durable write is not swallowed */
  it("rejects with the store's own failure rather than reporting success", async () => {
    const failure = new Error("clickhouse said no");
    const built = createSimulationProcessingPipeline({
      client: fakeClient({ insert: vi.fn().mockRejectedValue(failure) }),
    });

    const emitted = await built.commands.cancelRun!.handle(
      { scenarioRunId: "run-1", occurredAt: 1 },
      ctx,
    );

    await expect(
      built.folds.simulationRunState!.apply({
        key: "run-1",
        tenantId: "tenant-1",
        events: emitted,
      }),
    ).rejects.toThrow(failure);
  });
});

describe("given the fold's dispatch lane", () => {
  /** @scenario The fold's dispatch lane is scoped to one run, never a batch or set */
  it("scopes the lane to the run alone, with no batch or set in the key", () => {
    const key = simulationRunFoldGroupKey({
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
    });

    expect(key.scope).toEqual({
      kind: "aggregate",
      aggregateType: "simulation_run",
      aggregateId: "run-1",
    });
    expect(key.lane).toEqual({ kind: "fold", name: "simulationRunState" });

    // The function's own signature is the guarantee (there is no parameter to
    // pass a batch or set id through), but round-tripping the rendered key
    // confirms nothing downstream widens it either.
    const parsed = parseGroupKey(
      renderSimulationRunFoldGroupKey({
        tenantId: "tenant-1",
        scenarioRunId: "run-1",
      }),
    );
    expect(parsed).toEqual(key);
  });

  it("keys two different runs into two different lanes", () => {
    expect(
      renderSimulationRunFoldGroupKey({ tenantId: "t", scenarioRunId: "a" }),
    ).not.toBe(
      renderSimulationRunFoldGroupKey({ tenantId: "t", scenarioRunId: "b" }),
    );
  });

  it("keeps two runs from different tenants apart even with the same run id", () => {
    expect(
      renderSimulationRunFoldGroupKey({
        tenantId: "tenant-a",
        scenarioRunId: "run-1",
      }),
    ).not.toBe(
      renderSimulationRunFoldGroupKey({
        tenantId: "tenant-b",
        scenarioRunId: "run-1",
      }),
    );
  });
});

describe("given the members ADR-107's audit found dropped", () => {
  const processCtx = { now: 10_000, tenantId: "tenant-1", processKey: "run-1" };

  /** @scenario a queued run's target is dispatched from the outbox, and a
   * post-dispatch fault is recorded as a terminal failure rather than retried */
  it("scenarioExecution dispatches a queued run's target and records a fault as terminal", async () => {
    const executeRun = vi.fn().mockRejectedValue(new Error("child crashed"));
    const readRunStatus = vi.fn().mockResolvedValue("QUEUED");
    const emitFailure = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      scenarioExecution: { executeRun, readRunStatus, emitFailure },
    });

    const step = built.processManagers.scenarioExecution!.evolve(
      built.processManagers.scenarioExecution!.init(),
      {
        type: "lw.simulation_run.queued",
        data: {
          ...QUEUED_INPUT,
          target: { type: "prompt", referenceId: "p1" },
        },
      },
      processCtx,
    );
    expect(step?.intents).toHaveLength(1);
    expect(step?.nextWakeAt).not.toBeNull();

    const payload = step!.intents[0]!.payload as Record<string, unknown>;
    await built.processManagers.scenarioExecution!.intents.executeRun!.deliver(
      payload,
      ctx,
    );

    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioRunId: "run-1",
        target: { type: "prompt", referenceId: "p1" },
      }),
    );
    expect(emitFailure).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioRunId: "run-1", outcome: "error" }),
    );
  });

  /** @scenario a run gone quiet past its deadline is written as STALLED */
  it("scenarioExecution writes a stalled run as terminal on wake", () => {
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      scenarioExecution: {
        executeRun: vi.fn(),
        readRunStatus: vi.fn(),
        emitFailure: vi.fn(),
      },
    });

    const armed = built.processManagers.scenarioExecution!.evolve(
      built.processManagers.scenarioExecution!.init(),
      {
        type: "lw.simulation_run.queued",
        data: {
          ...QUEUED_INPUT,
          target: { type: "prompt", referenceId: "p1" },
        },
      },
      processCtx,
    )!;
    const wake = built.processManagers.scenarioExecution!.onWake!(
      armed.state,
      processCtx,
    );
    expect(wake.intents).toEqual([
      {
        type: "scenarioExecution/failRun",
        payload: expect.objectContaining({
          scenarioRunId: "run-1",
          outcome: "stalled",
        }),
      },
    ]);
  });

  /** @scenario a finished run's cost and latency are measured once it has settled */
  it("runMetrics measures a finished run once, on the settle deadline", async () => {
    const computeRunMetrics = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      runMetrics: { computeRunMetrics },
    });

    const step = built.processManagers.runMetrics!.evolve(
      built.processManagers.runMetrics!.init(),
      {
        type: "lw.simulation_run.finished",
        data: { scenarioRunId: "run-1", occurredAt: 10_000 },
      },
      processCtx,
    )!;
    expect(step.nextWakeAt).not.toBeNull();

    const wake = built.processManagers.runMetrics!.onWake!(
      step.state,
      processCtx,
    );
    const payload = wake.intents[0]!.payload as Record<string, unknown>;
    await built.processManagers.runMetrics!.intents.computeRunMetrics!.deliver(
      payload,
      ctx,
    );

    expect(computeRunMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", scenarioRunId: "run-1" }),
    );
  });

  /** @scenario a measurement recorded on the run ends the re-measure ladder */
  it("runMetrics stops asking once the run's own metrics event lands", () => {
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      runMetrics: { computeRunMetrics: vi.fn() },
    });

    const armed = built.processManagers.runMetrics!.evolve(
      built.processManagers.runMetrics!.init(),
      {
        type: "lw.simulation_run.finished",
        data: { scenarioRunId: "run-1", occurredAt: 10_000 },
      },
      processCtx,
    )!;
    const measured = built.processManagers.runMetrics!.evolve(
      armed.state,
      {
        type: "lw.simulation_run.metrics_recorded",
        data: {
          scenarioRunId: "run-1",
          traceIds: [],
          totalCost: 1,
          roleCosts: {},
          roleLatencies: {},
          occurredAt: 10_001,
        },
      },
      processCtx,
    )!;
    expect(measured.nextWakeAt).toBeNull();

    const wake = built.processManagers.runMetrics!.onWake!(
      measured.state,
      processCtx,
    );
    expect(wake.intents).toEqual([]);
  });

  /** @scenario the two billable simulation events poke the injected billing port */
  it("billingMeterPoke forwards started and messageSnapshot to the injected port", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      billingPoke: { handle },
    });

    await built.subscribers.billingMeterPoke!.handle(
      {
        type: "lw.simulation_run.started",
        data: {
          scenarioRunId: "run-1",
          scenarioId: "s",
          batchRunId: "b",
          scenarioSetId: "set",
          occurredAt: 1,
        },
      },
      ctx,
    );
    expect(handle).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  /** @scenario a run update broadcasts to SSE clients, but a streaming start does not */
  it("snapshotUpdateBroadcast nudges on run updates, but stays quiet for textMessageStart", async () => {
    const broadcastToTenant = vi.fn().mockResolvedValue(undefined);
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      broadcast: { broadcastToTenant },
    });

    await built.subscribers.snapshotUpdateBroadcast!.handle(
      {
        type: "lw.simulation_run.finished",
        data: { scenarioRunId: "run-1", occurredAt: 1 },
      },
      ctx,
    );
    expect(broadcastToTenant).toHaveBeenCalledWith(
      "tenant-1",
      JSON.stringify({ event: "simulation_updated", scenarioRunId: "run-1" }),
      "simulation_updated",
    );
    expect(built.subscribers.snapshotUpdateBroadcast!.eventTypes).not.toContain(
      "lw.simulation_run.text_message_start",
    );
  });

  /** @scenario a cancellation publishes to every worker pod, and a failed publish is not swallowed */
  it("cancellationBroadcast publishes the run id and rethrows on failure", async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const built = createSimulationProcessingPipeline({
      client: fakeClient(),
      cancellationPublisher: { publish },
    });

    await built.subscribers.cancellationBroadcast!.handle(
      {
        type: "lw.simulation_run.cancel_requested",
        data: { scenarioRunId: "run-1", occurredAt: 1 },
      },
      ctx,
    );
    expect(publish).toHaveBeenCalledWith(
      "scenario:cancel",
      JSON.stringify({ scenarioRunId: "run-1" }),
    );

    publish.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      built.subscribers.cancellationBroadcast!.handle(
        {
          type: "lw.simulation_run.cancel_requested",
          data: { scenarioRunId: "run-1", occurredAt: 1 },
        },
        ctx,
      ),
    ).rejects.toThrow("redis down");
  });
});

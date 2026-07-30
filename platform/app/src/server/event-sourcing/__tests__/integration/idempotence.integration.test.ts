import { createClickHouseClient } from "@langwatch/clickhouse";
import { LANE_REGISTRY_KEY } from "@langwatch/groupqueue";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderSimulationRunFoldGroupKey } from "~/server/event-sourcing/simulation-processing";
import {
  cleanupTestData,
  startTestContainers,
  stopTestContainers,
} from "~/test-utils/integration/testContainers";
import {
  deleteSimulationRunsFor,
  readEventLogRows,
  readSimulationRun,
} from "./support/simulationRunRow";
import {
  buildSimulationEngine,
  type SimulationEngine,
} from "./support/testEngine";

/**
 * ADR-107 decision 8, proven against a real `ReplacingMergeTree`: the same
 * command dispatched twice mints the same idempotency key, so `event_log`
 * collapses to one row under `FINAL` (not `OPTIMIZE ... FINAL` — a point
 * read scoped to this aggregate is cheap enough to force the merge at query
 * time rather than rewriting the whole table).
 */
describe("given the same command dispatched twice against real ClickHouse", () => {
  const suffix = nanoid(8);
  const tenantId = `tenant-idempotence-${suffix}`;
  const scenarioRunId = `run-${suffix}`;
  const input = {
    scenarioRunId,
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioSetId: "set-1",
    batchTotal: 4,
    occurredAt: Date.now(),
  };

  let containers: Awaited<ReturnType<typeof startTestContainers>>;
  let client: ReturnType<typeof createClickHouseClient>;
  let engine: SimulationEngine;
  let groupKey: string;

  beforeAll(async () => {
    containers = await startTestContainers();
    await containers.redisConnection.del(LANE_REGISTRY_KEY);
    client = createClickHouseClient({ url: containers.clickHouseUrl });
    engine = buildSimulationEngine({
      client,
      redis: containers.redisConnection,
    });
    groupKey = renderSimulationRunFoldGroupKey({ tenantId, scenarioRunId });
    await engine.service.start({ runsConsumers: true });
  }, 120_000);

  afterAll(async () => {
    await engine.service.stop();
    await cleanupTestData(tenantId);
    await deleteSimulationRunsFor(containers.clickHouseClient, tenantId);
    await client.close();
    await stopTestContainers();
  }, 120_000);

  it("collapses the retried dispatch onto one event_log row and one unchanged fold row", async () => {
    await engine.service.commands.send("queueRun", input, { tenantId });
    await vi.waitFor(
      async () => {
        await expect(engine.ports.queue.depth(groupKey)).resolves.toBe(0);
      },
      { timeout: 5_000, interval: 50 },
    );

    const firstRow = await readSimulationRun({
      client,
      tenantId,
      scenarioRunId,
    });
    const firstEventRows = await readEventLogRows({
      client,
      tenantId,
      aggregateId: scenarioRunId,
    });
    expect(firstEventRows).toHaveLength(1);
    expect(firstRow?.Status).toBe("QUEUED");

    // The retry: byte-identical input, so `toCommittedEvent` mints the same
    // `idempotencyKey` (ADR-107 decision 15) even though it mints a fresh
    // `eventId` — the second physical row is genuinely new, not a no-op.
    await engine.service.commands.send("queueRun", input, { tenantId });
    await vi.waitFor(
      async () => {
        await expect(engine.ports.queue.depth(groupKey)).resolves.toBe(0);
      },
      { timeout: 5_000, interval: 50 },
    );

    const secondEventRows = await readEventLogRows({
      client,
      tenantId,
      aggregateId: scenarioRunId,
    });
    expect(secondEventRows).toHaveLength(1);
    expect(secondEventRows[0]?.EventId).not.toBe(firstEventRows[0]?.EventId);
    expect(secondEventRows[0]?.EventPayload).toBe(
      firstEventRows[0]?.EventPayload,
    );

    const secondRow = await readSimulationRun({
      client,
      tenantId,
      scenarioRunId,
    });
    // StartedAt and UpdatedAt are write-time bookkeeping, not fold state:
    // simulationRunState never sets state.startedAt, so table.ts's row
    // mapping stamps StartedAt from the wall clock on every write, and
    // UpdatedAt always does. Everything else must be byte-identical.
    const {
      StartedAt: _firstStartedAt,
      UpdatedAt: _firstUpdatedAt,
      ...firstState
    } = firstRow ?? {};
    const {
      StartedAt: _secondStartedAt,
      UpdatedAt: _secondUpdatedAt,
      ...secondState
    } = secondRow ?? {};
    expect(secondState).toEqual(firstState);
  });
});

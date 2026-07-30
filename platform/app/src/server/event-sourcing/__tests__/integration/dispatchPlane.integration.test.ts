import { createClickHouseClient } from "@langwatch/clickhouse";
import { LANE_REGISTRY_KEY } from "@langwatch/groupqueue";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderSimulationRunFoldGroupKey } from "~/server/event-sourcing/simulation-processing";
import { SIMULATION_RUN_PIPELINE_NAME } from "~/server/event-sourcing/simulation-processing/events";
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
 * The engine's dispatch path, proven once end to end against real
 * infrastructure: a command reaches a real `event_log` row through a real
 * Redis lane, and a real fold row.
 *
 * simulation-processing over trace-processing: built with only `{ client }`,
 * `queueRun` fans out to exactly one subscriber, the `simulationRunState`
 * fold. trace-processing's `recordSpan` fans out to three (two folds plus the
 * `spanStorage` map), and that map's table is explicitly not deployed by any
 * migration — a third, unrelated failure this test does not want to carry.
 */
describe("given the simulation-processing pipeline dispatching through real infrastructure", () => {
  const suffix = nanoid(8);
  const tenantId = `tenant-dispatch-${suffix}`;
  const scenarioRunId = `run-${suffix}`;

  let containers: Awaited<ReturnType<typeof startTestContainers>>;
  let client: ReturnType<typeof createClickHouseClient>;
  let engine: SimulationEngine;

  beforeAll(async () => {
    containers = await startTestContainers();
    // groupqueue:lanes has no other adopter yet; files run serially, so
    // resetting it before staging keeps the claim scan scoped to this test.
    await containers.redisConnection.del(LANE_REGISTRY_KEY);
    client = createClickHouseClient({ url: containers.clickHouseUrl });
    engine = buildSimulationEngine({
      client,
      redis: containers.redisConnection,
    });
    await engine.service.start({ runsConsumers: false });
  }, 120_000);

  afterAll(async () => {
    await engine.service.stop();
    await cleanupTestData(tenantId);
    await deleteSimulationRunsFor(containers.clickHouseClient, tenantId);
    await client.close();
    await stopTestContainers();
  }, 120_000);

  it("carries a dispatched command to a durable event and a durable fold row", async () => {
    const groupKey = renderSimulationRunFoldGroupKey({
      tenantId,
      scenarioRunId,
    });

    await engine.service.commands.send(
      "queueRun",
      {
        scenarioRunId,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        batchTotal: 4,
        occurredAt: Date.now(),
      },
      { tenantId },
    );

    // Staged, and not yet claimed — the consumer has not started.
    await expect(engine.ports.queue.depth(groupKey)).resolves.toBe(1);

    await engine.service.start({ runsConsumers: true });
    await vi.waitFor(
      async () => {
        await expect(engine.ports.queue.depth(groupKey)).resolves.toBe(0);
      },
      { timeout: 5_000, interval: 50 },
    );

    const eventRows = await readEventLogRows({
      client,
      tenantId,
      aggregateId: scenarioRunId,
    });
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]).toMatchObject({
      TenantId: tenantId,
      AggregateType: SIMULATION_RUN_PIPELINE_NAME,
      AggregateId: scenarioRunId,
      EventType: "lw.simulation_run.queued",
    });

    const row = await readSimulationRun({ client, tenantId, scenarioRunId });
    expect(row).toMatchObject({
      TenantId: tenantId,
      ScenarioRunId: scenarioRunId,
      ScenarioId: "scenario-1",
      BatchRunId: "batch-1",
      ScenarioSetId: "set-1",
      Status: "QUEUED",
      BatchTotal: 4,
    });
  });
});

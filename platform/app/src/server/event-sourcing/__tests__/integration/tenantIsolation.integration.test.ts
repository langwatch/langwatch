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
 * ADR-109 decision 5: TenantId is the only identifier unique across tenants,
 * so it must lead every predicate. Two tenants dispatching the identical
 * logical command — same scenarioRunId — must land in two separate
 * event_log rows and two separate fold rows, and a read scoped to one
 * tenant must never surface the other's content.
 */
describe("given the same scenarioRunId dispatched under two tenants", () => {
  const suffix = nanoid(8);
  const tenantA = `tenant-isolation-a-${suffix}`;
  const tenantB = `tenant-isolation-b-${suffix}`;
  const scenarioRunId = `run-shared-${suffix}`;

  let containers: Awaited<ReturnType<typeof startTestContainers>>;
  let client: ReturnType<typeof createClickHouseClient>;
  let engine: SimulationEngine;

  beforeAll(async () => {
    containers = await startTestContainers();
    await containers.redisConnection.del(LANE_REGISTRY_KEY);
    client = createClickHouseClient({ url: containers.clickHouseUrl });
    engine = buildSimulationEngine({
      client,
      redis: containers.redisConnection,
    });
    await engine.service.start({ runsConsumers: true });
  }, 120_000);

  afterAll(async () => {
    await engine.service.stop();
    await cleanupTestData(tenantA);
    await cleanupTestData(tenantB);
    await deleteSimulationRunsFor(containers.clickHouseClient, tenantA);
    await deleteSimulationRunsFor(containers.clickHouseClient, tenantB);
    await client.close();
    await stopTestContainers();
  }, 120_000);

  it("keeps each tenant's event_log row and fold row apart", async () => {
    await engine.service.commands.send(
      "queueRun",
      {
        scenarioRunId,
        scenarioId: "scenario-a",
        batchRunId: "batch-a",
        scenarioSetId: "set-a",
        batchTotal: 1,
        occurredAt: Date.now(),
      },
      { tenantId: tenantA },
    );
    await engine.service.commands.send(
      "queueRun",
      {
        scenarioRunId,
        scenarioId: "scenario-b",
        batchRunId: "batch-b",
        scenarioSetId: "set-b",
        batchTotal: 2,
        occurredAt: Date.now(),
      },
      { tenantId: tenantB },
    );

    const groupKeyA = renderSimulationRunFoldGroupKey({
      tenantId: tenantA,
      scenarioRunId,
    });
    const groupKeyB = renderSimulationRunFoldGroupKey({
      tenantId: tenantB,
      scenarioRunId,
    });
    await vi.waitFor(
      async () => {
        await expect(engine.ports.queue.depth(groupKeyA)).resolves.toBe(0);
        await expect(engine.ports.queue.depth(groupKeyB)).resolves.toBe(0);
      },
      { timeout: 5_000, interval: 50 },
    );

    const eventsA = await readEventLogRows({
      client,
      tenantId: tenantA,
      aggregateId: scenarioRunId,
    });
    const eventsB = await readEventLogRows({
      client,
      tenantId: tenantB,
      aggregateId: scenarioRunId,
    });
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);
    expect(JSON.parse(eventsA[0]!.EventPayload)).toMatchObject({
      scenarioId: "scenario-a",
    });
    expect(JSON.parse(eventsB[0]!.EventPayload)).toMatchObject({
      scenarioId: "scenario-b",
    });

    const rowA = await readSimulationRun({
      client,
      tenantId: tenantA,
      scenarioRunId,
    });
    const rowB = await readSimulationRun({
      client,
      tenantId: tenantB,
      scenarioRunId,
    });
    expect(rowA).toMatchObject({
      TenantId: tenantA,
      ScenarioId: "scenario-a",
      BatchTotal: 1,
    });
    expect(rowB).toMatchObject({
      TenantId: tenantB,
      ScenarioId: "scenario-b",
      BatchTotal: 2,
    });
  });
});

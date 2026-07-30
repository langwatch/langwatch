import { createClickHouseClient } from "@langwatch/clickhouse";
import type { HandlerContext } from "@langwatch/event-sourcing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSimulationProcessingPipeline } from "~/server/event-sourcing/simulation-processing";
import {
  startTestContainers,
  stopTestContainers,
} from "~/test-utils/integration/testContainers";
import {
  deleteSimulationRunsFor,
  readSimulationRun,
} from "./support/simulationRunRow";

/**
 * ADR-107 decision 8's other half: not the log's dedup (idempotence.integration.test.ts),
 * but the fold itself. Re-applying an identical batch against the real
 * `simulationRunState` store must reach the exact state it already reached —
 * no counter it could double, no delta it could re-add.
 */
describe("given a fold batch applied twice against the real fold store", () => {
  const suffix = nanoid(8);
  const tenantId = `tenant-fold-redelivery-${suffix}`;
  const scenarioRunId = `run-${suffix}`;

  let containers: Awaited<ReturnType<typeof startTestContainers>>;
  let client: ReturnType<typeof createClickHouseClient>;

  beforeAll(async () => {
    containers = await startTestContainers();
    client = createClickHouseClient({ url: containers.clickHouseUrl });
  }, 120_000);

  afterAll(async () => {
    await deleteSimulationRunsFor(containers.clickHouseClient, tenantId);
    await client.close();
    await stopTestContainers();
  }, 120_000);

  it("reaches the identical stored state on redelivery", async () => {
    const pipeline = createSimulationProcessingPipeline({ client });
    const ctx: HandlerContext = { now: Date.now(), tenantId };

    const queued = await pipeline.commands.queueRun!.handle(
      {
        scenarioRunId,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        batchTotal: 3,
        occurredAt: 1_000,
      },
      ctx,
    );
    const metrics = await pipeline.commands.recordMetrics!.handle(
      {
        scenarioRunId,
        traceIds: ["trace-1"],
        totalCost: 1.25,
        roleCosts: { agent: [1.25] },
        roleLatencies: { agent: [42] },
        occurredAt: 2_000,
      },
      ctx,
    );
    const batch = [...queued, ...metrics];

    await pipeline.folds.simulationRunState!.apply({
      key: scenarioRunId,
      tenantId,
      events: batch,
    });
    const first = await readSimulationRun({ client, tenantId, scenarioRunId });
    expect(first?.Status).toBe("QUEUED");
    expect(first?.TotalCost).toBe(1.25);

    // Redelivery: the exact same batch, applied again.
    await pipeline.folds.simulationRunState!.apply({
      key: scenarioRunId,
      tenantId,
      events: batch,
    });
    const second = await readSimulationRun({ client, tenantId, scenarioRunId });

    // StartedAt and UpdatedAt are write-time bookkeeping, not fold state:
    // simulationRunState never sets state.startedAt, so table.ts's row
    // mapping stamps StartedAt from the wall clock on every write, and
    // UpdatedAt always does. Everything else is the fold's own output and
    // must be byte-identical.
    const {
      StartedAt: _firstStartedAt,
      UpdatedAt: _firstUpdatedAt,
      ...firstState
    } = first ?? {};
    const {
      StartedAt: _secondStartedAt,
      UpdatedAt: _secondUpdatedAt,
      ...secondState
    } = second ?? {};
    expect(secondState).toEqual(firstState);
  });
});

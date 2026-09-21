/**
 * A finished run stores the connected agent instance that served it, and the
 * stored metadata reads back through the reserved namespace.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import { langwatchMetadataSchema } from "~/server/scenarios/schemas/event-schemas";
import { createTenantId } from "../../../../";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../__tests__/integration/testContainers";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  type SimulationRunState,
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../../projections/simulationRunState.foldProjection";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import { SimulationRunStateRepositoryClickHouse } from "../simulationRunState.clickhouse.repository";

const tenantId = `test-sim-instance-${nanoid()}`;
const TENANT = createTenantId(tenantId);

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const foldProjection = new SimulationRunStateFoldProjection({
  store: noopStore,
});

let ch: ClickHouseClient;
let repo: SimulationRunStateRepositoryClickHouse<SimulationRunState>;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new SimulationRunStateRepositoryClickHouse<SimulationRunState>(
    async () => resilient,
  );
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

/** The events of one run against a connected agent, in log order. */
function eventsOf(scenarioRunId: string): SimulationProcessingEvent[] {
  const base = {
    aggregateId: scenarioRunId,
    aggregateType: "simulation_run" as const,
    tenantId: TENANT,
  };
  return [
    {
      ...base,
      id: `evt-${nanoid()}`,
      createdAt: 1000,
      occurredAt: 1000,
      type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
      version: SIMULATION_EVENT_VERSIONS.QUEUED,
      data: {
        scenarioRunId,
        scenarioId: `scenario-${nanoid()}`,
        batchRunId: `batch-${nanoid()}`,
        scenarioSetId: `set-${nanoid()}`,
        name: "Double charge",
        metadata: {
          parameters: { model: "gpt-5-mini" },
          langwatch: {
            targetReferenceId: "agent_1",
            targetType: "connected",
            targetKey: "agent_1",
          },
        },
      },
    },
    {
      ...base,
      id: `evt-${nanoid()}`,
      createdAt: 5000,
      occurredAt: 5000,
      type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
      version: SIMULATION_EVENT_VERSIONS.FINISHED,
      data: {
        scenarioRunId,
        status: "SUCCESS",
        results: {
          verdict: "success",
          reasoning: "All criteria met",
          metCriteria: ["Refunds the second charge"],
          unmetCriteria: [],
        },
      },
    },
    {
      ...base,
      id: `evt-${nanoid()}`,
      createdAt: 5100,
      occurredAt: 5100,
      type: SIMULATION_RUN_EVENT_TYPES.AGENT_INSTANCE_RECORDED,
      version: SIMULATION_EVENT_VERSIONS.AGENT_INSTANCE_RECORDED,
      data: {
        scenarioRunId,
        agentInstance: { hostname: "worker-1", label: "blue" },
      },
    },
  ];
}

describe("simulation_runs with a served agent instance (integration)", () => {
  const context = { tenantId: TENANT };

  describe("when a finished run has its instance recorded and is stored", () => {
    /** @scenario "A finished run stores the instance that served it" */
    it("reads the instance back under the reserved langwatch namespace", async () => {
      const scenarioRunId = `run-instance-${nanoid()}`;
      let data = foldProjection.init();
      for (const event of eventsOf(scenarioRunId)) {
        data = foldProjection.apply(data, event);
      }

      await repo.storeProjection(
        {
          id: `proj-${nanoid()}`,
          aggregateId: scenarioRunId,
          tenantId: TENANT,
          version: "2026-08-30",
          data,
        } as unknown as SimulationRunState,
        context,
      );

      const stored = await repo.getProjection(scenarioRunId, context);
      expect(stored).not.toBeNull();
      expect(stored!.data.Status).toBe("SUCCESS");
      expect(stored!.data.Verdict).toBe("success");

      const metadata = JSON.parse(stored!.data.Metadata ?? "null");
      expect(metadata.parameters).toEqual({ model: "gpt-5-mini" });
      expect(metadata.langwatch.targetKey).toBe("agent_1");
      expect(metadata.langwatch.agentInstance).toEqual({
        hostname: "worker-1",
        label: "blue",
      });

      const namespace = langwatchMetadataSchema.parse(metadata.langwatch);
      expect(namespace.agentInstance).toEqual({
        hostname: "worker-1",
        label: "blue",
      });
    });
  });
});

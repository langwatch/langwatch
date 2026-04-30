import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  SimulationClickHouseRepository,
  RUN_ID_CAP,
} from "../simulation.clickhouse.repository";

function makeRowsOfLength(n: number): { ScenarioRunId: string }[] {
  return Array.from({ length: n }, (_, i) => ({ ScenarioRunId: `run-${i}` }));
}

function makeMockClientReturning(rows: { ScenarioRunId: string }[]): ClickHouseClient {
  const jsonFn = vi.fn().mockResolvedValue(rows);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn } as unknown as ClickHouseClient;
}

describe("SimulationClickHouseRepository", () => {
  describe("getRunIdsForSet()", () => {
    describe("when N matching ids returns exactly RUN_ID_CAP", () => {
      it("sets reachedCap to true and returns RUN_ID_CAP runIds", async () => {
        const rows = makeRowsOfLength(RUN_ID_CAP);
        const mockClient = makeMockClientReturning(rows);
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getRunIdsForSet({
          projectId: "project-1",
          scenarioSetId: "set-a",
        });

        expect(result.runIds.length).toBe(RUN_ID_CAP);
        expect(result.reachedCap).toBe(true);
      });
    });

    describe("when N matching ids returns fewer than RUN_ID_CAP", () => {
      it("sets reachedCap to false", async () => {
        const rows = makeRowsOfLength(RUN_ID_CAP - 1);
        const mockClient = makeMockClientReturning(rows);
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getRunIdsForSet({
          projectId: "project-1",
          scenarioSetId: "set-a",
        });

        expect(result.runIds.length).toBe(RUN_ID_CAP - 1);
        expect(result.reachedCap).toBe(false);
      });
    });
  });
});

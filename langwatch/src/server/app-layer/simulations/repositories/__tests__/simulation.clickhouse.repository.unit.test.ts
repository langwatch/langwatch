import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { SimulationClickHouseRepository } from "../simulation.clickhouse.repository";

function makeMockClient(): ClickHouseClient {
  const jsonFn = vi.fn().mockResolvedValue([]);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn } as unknown as ClickHouseClient;
}

function makeMockClientWithQueryCapture(): {
  client: ClickHouseClient;
  getCapturedQueries: () => { query: string; params: Record<string, unknown> }[];
} {
  const capturedQueries: { query: string; params: Record<string, unknown> }[] = [];
  const queryFn = vi.fn().mockImplementation(({ query, query_params }) => {
    capturedQueries.push({ query, params: query_params });
    return Promise.resolve({ json: () => Promise.resolve([]) });
  });
  return {
    client: { query: queryFn } as unknown as ClickHouseClient,
    getCapturedQueries: () => capturedQueries,
  };
}

describe("SimulationClickHouseRepository", () => {
  describe("getDistinctExternalSetIds()", () => {
    describe("when called with projectIds", () => {
      it("resolves the client via first projectId, not 'unknown'", async () => {
        const mockClient = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getDistinctExternalSetIds({
          projectIds: ["project-1", "project-2"],
        });

        expect(resolver).toHaveBeenCalledWith("project-1");
        expect(resolver).not.toHaveBeenCalledWith("unknown");
      });
    });

    describe("when called with empty projectIds", () => {
      it("returns empty set without calling the resolver", async () => {
        const resolver = vi.fn();
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getDistinctExternalSetIds({
          projectIds: [],
        });

        expect(result).toEqual(new Set());
        expect(resolver).not.toHaveBeenCalled();
      });
    });
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when ClickHouse returns empty string for ScenarioSetId", () => {
      it("normalizes empty ScenarioSetId to 'default' in the SQL query", async () => {
        const { client, getCapturedQueries } = makeMockClientWithQueryCapture();
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getRunDataForAllSuites({ projectId: "project-1" });

        const queries = getCapturedQueries();
        const batchQuery = queries.find((q) => q.query.includes("BatchRunId"));

        expect(batchQuery).toBeDefined();
        expect(batchQuery?.query).toContain(
          "IF(ScenarioSetId = '', 'default', ScenarioSetId)"
        );
        expect(batchQuery?.query).not.toMatch(
          /any\(ScenarioSetId\)\s+AS\s+ScenarioSetId/
        );
      });
    });
  });
});

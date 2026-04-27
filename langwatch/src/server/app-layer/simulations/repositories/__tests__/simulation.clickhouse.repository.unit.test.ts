import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { SimulationClickHouseRepository } from "../simulation.clickhouse.repository";
import { DEFAULT_SET_ID } from "~/server/scenarios/internal-set-id";

function makeMockClient(rows: unknown[] = []): ClickHouseClient {
  const jsonFn = vi.fn().mockResolvedValue(rows);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn } as unknown as ClickHouseClient;
}

function makeMockClientWithQueryCapture(options?: {
  rowsForQuery?: (query: string) => unknown[];
}): {
  client: ClickHouseClient;
  getCapturedQueries: () => { query: string; params: Record<string, unknown> }[];
} {
  const capturedQueries: { query: string; params: Record<string, unknown> }[] = [];
  const queryFn = vi.fn().mockImplementation(({ query, query_params }) => {
    capturedQueries.push({ query, params: query_params });
    const rows = options?.rowsForQuery?.(query) ?? [];
    return Promise.resolve({ json: () => Promise.resolve(rows) });
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

      it("sends a SQL query containing the IF normalization expression", async () => {
        const mockClient = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        const firstCallArg = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { query: string } | undefined;
        expect(firstCallArg?.query).toContain(
          "IF(ScenarioSetId = '',"
        );
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

    describe("when ClickHouse returns both empty-string and 'default' ScenarioSetId", () => {
      it("normalizes empty string to DEFAULT_SET_ID and returns one distinct set", async () => {
        const mockClient = makeMockClient([
          { ScenarioSetId: "" },
          { ScenarioSetId: DEFAULT_SET_ID },
        ]);
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        expect(result).toEqual(new Set([DEFAULT_SET_ID]));
        expect(result.size).toBe(1);
      });
    });

    describe("when ClickHouse returns only empty-string ScenarioSetId", () => {
      it("normalizes empty string to DEFAULT_SET_ID", async () => {
        const mockClient = makeMockClient([{ ScenarioSetId: "" }]);
        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getDistinctExternalSetIds({
          projectIds: ["project-1"],
        });

        expect(result).toEqual(new Set([DEFAULT_SET_ID]));
      });
    });
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when ClickHouse returns empty string for ScenarioSetId", () => {
      it("normalizes empty ScenarioSetId to 'default' in the returned scenarioSetIds", async () => {
        const { client, getCapturedQueries } =
          makeMockClientWithQueryCapture({
            rowsForQuery: (query) => {
              if (query.includes("GROUP BY BatchRunId")) {
                return [
                  {
                    BatchRunId: "batch-1",
                    MaxCreatedAt: "1710000000000",
                    NormalizedSetId: "default",
                  },
                ];
              }
              return [];
            },
          });
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new SimulationClickHouseRepository(resolver);

        const result = await repo.getRunDataForAllSuites({
          projectId: "project-1",
        });

        expect(result.changed).toBe(true);
        if (result.changed) {
          expect(result.scenarioSetIds["batch-1"]).toBe("default");
        }

        const queries = getCapturedQueries();
        const batchQuery = queries.find((q) =>
          q.query.includes("GROUP BY BatchRunId")
        );
        expect(batchQuery?.query).toContain(
          "IF(ScenarioSetId = '', 'default', ScenarioSetId)"
        );
        expect(batchQuery?.query).not.toMatch(
          /any\(ScenarioSetId\)\s+AS\s+ScenarioSetId/
        );
      });
    });

    // Regression: ClickHouse rejects queries where a SELECT alias shadows a
    // column referenced in WHERE — the aggregate any(IF(...)) must NOT be
    // aliased as ScenarioSetId because the dedup IN-tuple in WHERE references
    // the underlying ScenarioSetId column.
    // See: simulation.clickhouse.repository.ts getRunDataForAllSuites()
    describe("when the outer SELECT aggregates the normalized set id", () => {
      it("does not alias the aggregate as ScenarioSetId (would shadow the column in WHERE)", async () => {
        const { client, getCapturedQueries } =
          makeMockClientWithQueryCapture({
            rowsForQuery: () => [],
          });
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getRunDataForAllSuites({ projectId: "project-1" });

        const batchQuery = getCapturedQueries().find((q) =>
          q.query.includes("GROUP BY BatchRunId")
        );
        expect(batchQuery?.query).not.toMatch(
          /any\(IF\(ScenarioSetId[^)]*\)\)\s+AS\s+ScenarioSetId\b/
        );
        expect(batchQuery?.query).toMatch(
          /any\(IF\(ScenarioSetId[^)]*\)\)\s+AS\s+NormalizedSetId\b/
        );
      });
    });
  });
});

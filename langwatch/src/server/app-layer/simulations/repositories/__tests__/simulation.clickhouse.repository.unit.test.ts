import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { SimulationClickHouseRepository } from "../simulation.clickhouse.repository";
import { DEFAULT_SET_ID } from "~/server/scenarios/internal-set-id";

function makeMockClient(rows: unknown[] = []): ClickHouseClient {
  const jsonFn = vi.fn().mockResolvedValue(rows);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn } as unknown as ClickHouseClient;
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
});

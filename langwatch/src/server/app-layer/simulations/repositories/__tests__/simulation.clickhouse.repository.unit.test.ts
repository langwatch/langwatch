import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { SimulationClickHouseRepository } from "../simulation.clickhouse.repository";

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForOrganization: vi.fn(),
}));

import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";

function makeMockClient(): ClickHouseClient {
  const jsonFn = vi.fn().mockResolvedValue([]);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { query: queryFn } as unknown as ClickHouseClient;
}

describe("SimulationClickHouseRepository", () => {
  describe("getExternalSetIdsForOrganization()", () => {
    describe("when called with organizationId and projectIds", () => {
      it("resolves the client via organizationId, not 'unknown'", async () => {
        const mockClient = makeMockClient();
        vi.mocked(getClickHouseClientForOrganization).mockResolvedValue(mockClient);

        const resolver = vi.fn().mockResolvedValue(mockClient);
        const repo = new SimulationClickHouseRepository(resolver);

        await repo.getExternalSetIdsForOrganization({
          organizationId: "org-1",
          projectIds: ["project-1", "project-2"],
        });

        expect(getClickHouseClientForOrganization).toHaveBeenCalledWith("org-1");
        expect(resolver).not.toHaveBeenCalledWith("unknown");
      });
    });
  });
});

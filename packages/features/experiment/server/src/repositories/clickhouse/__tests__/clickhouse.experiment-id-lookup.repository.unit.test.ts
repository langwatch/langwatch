import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExperimentClickHouseAdapter } from "../../../adapters/experiment-clickhouse.adapter";
import {
  ExperimentIdLookupClickHouseRepository,
  NullExperimentIdLookupRepository,
} from "../clickhouse.experiment-id-lookup.repository";

describe("ExperimentIdLookupClickHouseRepository", () => {
  const resolveClient = vi.fn();
  const mockQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resolveClient.mockResolvedValue({ query: mockQuery });
  });

  describe("given a run with a matching row", () => {
    describe("when the experiment id is looked up", () => {
      it("returns the row's ExperimentId", async () => {
        mockQuery.mockResolvedValue({
          json: async () => [{ ExperimentId: "exp-1" }],
        });
        const repository = new ExperimentIdLookupClickHouseRepository(
          ExperimentClickHouseAdapter.create(resolveClient),
        );

        const result = await repository.findExperimentId({
          tenantId: "tenant-1",
          runId: "run-1",
        });

        expect(result).toBe("exp-1");
        expect(resolveClient).toHaveBeenCalledWith("tenant-1");
        expect(mockQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: { tenantId: "tenant-1", runId: "run-1" },
          }),
        );
        const call = mockQuery.mock.calls[0]![0] as { query: string };
        expect(call.query).toContain("TenantId = {tenantId:String}");
      });
    });
  });

  describe("given no matching row", () => {
    describe("when the experiment id is looked up", () => {
      it("returns null", async () => {
        mockQuery.mockResolvedValue({ json: async () => [] });
        const repository = new ExperimentIdLookupClickHouseRepository(
          ExperimentClickHouseAdapter.create(resolveClient),
        );

        const result = await repository.findExperimentId({
          tenantId: "tenant-1",
          runId: "run-1",
        });

        expect(result).toBeNull();
      });
    });
  });
});

describe("NullExperimentIdLookupRepository", () => {
  it("always returns null", async () => {
    const repository = new NullExperimentIdLookupRepository();

    await expect(
      repository.findExperimentId({ tenantId: "tenant-1", runId: "run-1" }),
    ).resolves.toBeNull();
  });
});

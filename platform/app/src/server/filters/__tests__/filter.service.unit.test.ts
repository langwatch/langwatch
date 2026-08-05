import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilterOptionsClickHouseRepository } from "~/server/app-layer/filters/repositories/filter-options.clickhouse.repository";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import type { ClickHouseFilterQueryParams } from "../clickhouse";
import { FilterService, type GetFilterOptionsInput } from "../filter.service";

const extractedOptions = [{ field: "opt-1", label: "Option 1", count: 3 }];

vi.mock("../clickhouse", () => ({
  buildScopeConditions: () => ({ sql: "", params: {} }),
  clickHouseFilters: {
    // Standard supported filter with proper TenantId isolation.
    "topics.topics": {
      tableName: "trace_summaries",
      buildQuery: () =>
        "SELECT TopicId as field FROM trace_summaries WHERE TenantId = {tenantId:String}",
      extractResults: () => extractedOptions,
    },
    // Key-requiring filter: null query when the key is missing.
    "metadata.value": {
      tableName: "trace_summaries",
      buildQuery: (params: ClickHouseFilterQueryParams) =>
        params.key
          ? "SELECT field FROM trace_summaries WHERE TenantId = {tenantId:String}"
          : null,
      extractResults: () => extractedOptions,
    },
    // Filter with no ClickHouse support.
    "traces.name": {
      tableName: null,
      buildQuery: () => null,
      extractResults: () => [],
    },
    // Misbehaving definition missing the TenantId predicate.
    "spans.type": {
      tableName: "trace_summaries",
      buildQuery: () => "SELECT field FROM trace_summaries",
      extractResults: () => extractedOptions,
    },
  },
}));

/** Stands in for the resolver the repository is constructed with. */
const resolveClient = vi.fn();

/** The service under test, reading through a real repository over a fake client. */
function serviceOver(client: unknown): FilterService {
  resolveClient.mockResolvedValue(client);
  return new FilterService(
    new FilterOptionsClickHouseRepository(resolveClient),
  );
}

function makeInput(
  overrides: Partial<GetFilterOptionsInput> = {},
): GetFilterOptionsInput {
  return {
    projectId: "project-1",
    field: "topics.topics",
    startDate: 1_000,
    endDate: 2_000,
    ...overrides,
  };
}

function makeClient(rows: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
  };
}

describe("FilterService.getFilterOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given an empty projectId", () => {
    it("throws before looking up the ClickHouse client", async () => {
      const service = serviceOver(makeClient());

      await expect(
        service.getFilterOptions(makeInput({ projectId: "  " })),
      ).rejects.toThrow(/projectId \(tenantId\) must be a non-empty string/);
      expect(resolveClient).not.toHaveBeenCalled();
    });
  });

  describe("given no ClickHouse client is available", () => {
    it("throws a client-unavailable error", async () => {
      const service = new FilterService(null);

      await expect(service.getFilterOptions(makeInput())).rejects.toThrow(
        /ClickHouse client is not available/,
      );
    });
  });

  describe("given a filter with no ClickHouse support", () => {
    it("resolves to an empty option list without querying", async () => {
      const client = makeClient();
      const service = serviceOver(client);

      const result = await service.getFilterOptions(
        makeInput({ field: "traces.name" }),
      );

      expect(result).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe("given a key-requiring filter called without a key", () => {
    it("resolves to an empty option list without querying", async () => {
      const client = makeClient();
      const service = serviceOver(client);

      const result = await service.getFilterOptions(
        makeInput({ field: "metadata.value" }),
      );

      expect(result).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe("given a query missing TenantId isolation", () => {
    it("fails closed without executing the query", async () => {
      const client = makeClient();
      const service = serviceOver(client);

      await expect(
        service.getFilterOptions(makeInput({ field: "spans.type" })),
      ).rejects.toThrow("Failed to fetch filter options");
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe("when the key contains middle-dot encoded dots", () => {
    it("decodes them back to dots in the query params", async () => {
      const client = makeClient();
      const service = serviceOver(client);

      await service.getFilterOptions(
        makeInput({ field: "metadata.value", key: "foo·bar", subkey: "a·b" }),
      );

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({
            tenantId: "project-1",
            key: "foo.bar",
            subkey: "a.b",
          }),
        }),
      );
    });
  });

  describe("when the query succeeds", () => {
    it("returns the extractResults output", async () => {
      const client = makeClient([{ field: "raw" }]);
      const service = serviceOver(client);

      const result = await service.getFilterOptions(makeInput());

      expect(result).toEqual(extractedOptions);
    });
  });

  describe("when the platform sheds the query", () => {
    it("keeps the overload error instead of flattening it", async () => {
      // The typed error exists so the client can offer retry guidance rather
      // than "something went wrong". A catch-all that rewrapped it would
      // throw away the only thing distinguishing shedding from a bad filter.
      const client = {
        query: vi.fn().mockRejectedValue(new ClickHouseOverloadedError()),
      };
      const service = serviceOver(client);

      const error = await service
        .getFilterOptions(makeInput())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClickHouseOverloadedError);
      expect((error as ClickHouseOverloadedError).code).toBe(
        "clickhouse_overloaded",
      );
    });
  });

  describe("when ClickHouse rejects the query", () => {
    it("rethrows a generic error instead of the raw ClickHouse message", async () => {
      const client = {
        query: vi
          .fn()
          .mockRejectedValue(
            new Error("Code: 62. DB::Exception: Syntax error: SELECT secret"),
          ),
      };
      const service = serviceOver(client);

      const error = await service
        .getFilterOptions(makeInput())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Failed to fetch filter options");
      expect((error as Error).message).not.toContain("SELECT");
    });
  });
});

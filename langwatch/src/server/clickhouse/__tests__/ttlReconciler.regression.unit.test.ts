import { beforeEach, describe, expect, it, vi } from "vitest";

const clickhouseMocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    command: vi.fn(),
    close: vi.fn(),
  };
  return {
    client,
    createClient: vi.fn(() => client),
  };
});

vi.mock("@clickhouse/client", () => ({
  createClient: clickhouseMocks.createClient,
}));

import { reconcileTTL, TIERED_STORAGE_POLICY } from "../ttlReconciler";

describe("reconcileTTL()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clickhouseMocks.client.query.mockResolvedValue({
      json: async () => [
        {
          name: "stored_spans",
          storage_policy: TIERED_STORAGE_POLICY,
          engine_full:
            "MergeTree ORDER BY (TenantId) TTL toDateTime(EndTime) + toIntervalDay(49) TO VOLUME 'cold'",
        },
      ],
    });
    clickhouseMocks.client.command.mockResolvedValue(undefined);
    clickhouseMocks.client.close.mockResolvedValue(undefined);
  });

  describe("when a tiered table has current cold-storage TTL but no retention TTL", () => {
    /** @scenario Existing tiered tables receive missing retention TTL */
    it("adds the retention TTL without removing cold-storage TTL", async () => {
      await reconcileTTL({ connectionUrl: "http://localhost:8123/default" });

      expect(clickhouseMocks.client.command).toHaveBeenCalledWith({
        query: expect.stringContaining(
          "toDateTime(EndTime) + INTERVAL 49 DAY TO VOLUME 'cold'",
        ),
      });
      expect(clickhouseMocks.client.command).toHaveBeenCalledWith({
        query: expect.stringContaining("_retention_days"),
      });
    });
  });
});

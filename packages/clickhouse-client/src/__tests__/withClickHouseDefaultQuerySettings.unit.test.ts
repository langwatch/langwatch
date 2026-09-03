import { describe, expect, it, vi } from "vitest";
import { withClickHouseDefaultQuerySettings } from "../managed-client";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "../queryDefaults";

function mockClient() {
  const query = vi.fn().mockResolvedValue({ json: () => [] });
  return { query, insert: vi.fn(), command: vi.fn(), exec: vi.fn(), ping: vi.fn(), close: vi.fn() };
}

describe("withClickHouseDefaultQuerySettings", () => {
  describe("given a query with no clickhouse_settings", () => {
    it("injects the default settings", async () => {
      const client = mockClient();
      const wrapped = withClickHouseDefaultQuerySettings(client, DEFAULT_CLICKHOUSE_SETTINGS);

      await wrapped.query({ query: "SELECT 1", format: "JSONEachRow" });

      expect(client.query).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: DEFAULT_CLICKHOUSE_SETTINGS,
      });
    });
  });

  describe("given a query with caller-provided clickhouse_settings", () => {
    /** @scenario Memory safety setting does not override explicit per-query settings */
    it("merges defaults with caller overrides taking precedence", async () => {
      const client = mockClient();
      const wrapped = withClickHouseDefaultQuerySettings(client, DEFAULT_CLICKHOUSE_SETTINGS);

      await wrapped.query({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: { max_bytes_before_external_group_by: "1000000000" },
      });

      expect(client.query).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: {
          ...DEFAULT_CLICKHOUSE_SETTINGS,
          max_bytes_before_external_group_by: "1000000000",
        },
      });
    });
  });
});

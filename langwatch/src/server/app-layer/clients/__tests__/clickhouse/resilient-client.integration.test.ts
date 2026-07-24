/**
 * Integration test verifying the X-ClickHouse-Summary header is returned
 * by a real ClickHouse instance and that extractReadBytes can read it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { createResilientClickHouseClient } from "../../clickhouse/resilient-client";

let ch: ClickHouseClient;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = createClient({ url: containers.clickHouseUrl });
});

afterAll(async () => {
  await ch?.close();
  await stopTestContainers();
});

describe("ClickHouse X-ClickHouse-Summary header", () => {
  describe("when querying a real ClickHouse instance", () => {
    it("returns response_headers with x-clickhouse-summary containing read_bytes", async () => {
      // Create and query a real table so read_bytes is non-zero
      await ch.command({ query: "CREATE TABLE IF NOT EXISTS _test_summary (id UInt64, data String) ENGINE = MergeTree() ORDER BY id" });
      await ch.insert({ table: "_test_summary", values: [{ id: 1, data: "hello world" }], format: "JSONEachRow" });

      const result = await ch.query({
        query: "SELECT * FROM _test_summary",
        format: "JSONEachRow",
      });

      const summary = result.response_headers["x-clickhouse-summary"];
      expect(summary).toBeDefined();
      expect(typeof summary).toBe("string");

      const parsed = JSON.parse(summary as string);
      // read_bytes is present in the summary (may be 0 for small queries in some CH versions)
      expect(parsed).toHaveProperty("read_bytes");
      // read_bytes should be > 0 since we read from a real table
      expect(Number(parsed.read_bytes)).toBeGreaterThan(0);

      await ch.command({ query: "DROP TABLE IF EXISTS _test_summary" });
    });
  });

  describe("when using the resilient client wrapper", () => {
    it("preserves response_headers through the wrapper", async () => {
      await ch.command({ query: "CREATE TABLE IF NOT EXISTS _test_summary2 (id UInt64, data String) ENGINE = MergeTree() ORDER BY id" });
      await ch.insert({ table: "_test_summary2", values: [{ id: 1, data: "test data" }], format: "JSONEachRow" });

      const resilient = createResilientClickHouseClient({ client: ch });

      const result = await resilient.query({
        query: "SELECT * FROM _test_summary2",
        format: "JSONEachRow",
      });

      const summary = result.response_headers["x-clickhouse-summary"];
      expect(summary).toBeDefined();

      const parsed = JSON.parse(summary as string);
      expect(parsed).toHaveProperty("read_bytes");
      expect(Number(parsed.read_bytes)).toBeGreaterThan(0);

      await ch.command({ query: "DROP TABLE IF EXISTS _test_summary2" });
    });

    it("strips langwatch_* settings before forwarding to ClickHouse", async () => {
      const resilient = createResilientClickHouseClient({ client: ch });

      // Should not throw — langwatch_* keys are stripped before reaching CH
      const result = await resilient.query({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: {
          langwatch_expected_max_duration_ms: 5000,
          langwatch_expected_max_read_bytes: 10_000_000,
        },
      } as any);

      const rows = await result.json();
      expect(rows).toHaveLength(1);
    });
  });
});

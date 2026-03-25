/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { wrapWithDefaultSettings } from "../safeClickhouseClient";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "../queryDefaults";

function createMockClient(
  queryResult?: unknown,
): ClickHouseClient & { querySpy: ReturnType<typeof vi.fn> } {
  const querySpy = vi.fn().mockResolvedValue(queryResult ?? { json: () => [] });
  const client = {
    query: querySpy,
    insert: vi.fn(),
    command: vi.fn(),
    exec: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
  } as unknown as ClickHouseClient & { querySpy: typeof querySpy };
  client.querySpy = querySpy;
  return client;
}

describe("wrapWithDefaultSettings", () => {
  describe("when calling query without clickhouse_settings", () => {
    it("injects DEFAULT_CLICKHOUSE_SETTINGS", async () => {
      const mock = createMockClient();
      const wrapped = wrapWithDefaultSettings(mock);

      await wrapped.query({
        query: "SELECT 1",
        format: "JSONEachRow",
      });

      expect(mock.querySpy).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: DEFAULT_CLICKHOUSE_SETTINGS,
      });
    });
  });

  describe("when calling query with caller-provided clickhouse_settings", () => {
    it("merges defaults with caller overrides taking precedence", async () => {
      const mock = createMockClient();
      const wrapped = wrapWithDefaultSettings(mock);

      await wrapped.query({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: {
          max_memory_usage: "4000000000",
        },
      });

      expect(mock.querySpy).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: {
          ...DEFAULT_CLICKHOUSE_SETTINGS,
          max_memory_usage: "4000000000",
        },
      });
    });
  });

  describe("when calling query with extra caller settings", () => {
    it("preserves both defaults and extra settings", async () => {
      const mock = createMockClient();
      const wrapped = wrapWithDefaultSettings(mock);

      await wrapped.query({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });

      expect(mock.querySpy).toHaveBeenCalledWith({
        query: "SELECT 1",
        format: "JSONEachRow",
        clickhouse_settings: {
          ...DEFAULT_CLICKHOUSE_SETTINGS,
          max_execution_time: 30,
        },
      });
    });
  });

  describe("when calling non-query methods", () => {
    it("passes through insert without modification", async () => {
      const mock = createMockClient();
      const wrapped = wrapWithDefaultSettings(mock);

      await wrapped.insert({
        table: "test",
        values: [{ id: "1" }],
        format: "JSONEachRow",
      });

      expect(mock.insert).toHaveBeenCalledWith({
        table: "test",
        values: [{ id: "1" }],
        format: "JSONEachRow",
      });
    });

    it("delegates close without modification", async () => {
      const mock = createMockClient();
      const wrapped = wrapWithDefaultSettings(mock);

      await wrapped.close();

      expect(mock.close).toHaveBeenCalled();
    });
  });
});

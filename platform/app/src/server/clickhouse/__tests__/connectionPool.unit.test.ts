import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => mockLogger,
}));

import { getClickHouseMaxOpenConnections } from "../connectionPool";

// Every knob the resolver reads: the process may really be running inside a
// deployment that sets some of them (haven exports the server cap), and a
// leaked value must not change what these tests observe.
const POOL_ENV_VARS = [
  "CLICKHOUSE_MAX_OPEN_CONNECTIONS",
  "CLICKHOUSE_CLIENT_REPLICAS",
  "CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES",
  "CLICKHOUSE_SERVER_NODES",
  "CLICKHOUSE_CLIENTS_PER_PROCESS",
] as const;

describe("getClickHouseMaxOpenConnections", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of POOL_ENV_VARS) {
      original.set(name, process.env[name]);
      delete process.env[name];
    }
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    for (const name of POOL_ENV_VARS) {
      const value = original.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  describe("when the env var is unset", () => {
    it("returns the default of 64", () => {
      expect(getClickHouseMaxOpenConnections()).toBe(64);
    });
  });

  describe("when the env var holds a valid integer", () => {
    it("returns that value", () => {
      process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS = "128";
      expect(getClickHouseMaxOpenConnections()).toBe(128);
    });

    it("accepts the lower bound of 1", () => {
      process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS = "1";
      expect(getClickHouseMaxOpenConnections()).toBe(1);
    });
  });

  describe("when the env var is invalid", () => {
    it.each([
      ["non-numeric", "lots"],
      ["zero", "0"],
      ["negative", "-5"],
      ["fractional", "2.5"],
      ["above the hard cap", "5000"],
      ["empty string", ""],
    ])("falls back to the default for %s", (_label, raw) => {
      process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS = raw;
      expect(getClickHouseMaxOpenConnections()).toBe(64);
    });
  });

  describe("when the server states its cap but the fleet size is unknown", () => {
    /** @scenario "A known server cap bounds the fallback even when the fleet size is unknown" */
    it("clamps to what one process may claim of that budget", () => {
      process.env.CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES = "32";
      expect(getClickHouseMaxOpenConnections()).toBe(22);
    });

    /** @scenario "A known server cap bounds the fallback even when the fleet size is unknown" */
    it("warns so the operator learns to state the fleet size", () => {
      process.env.CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES = "32";
      getClickHouseMaxOpenConnections();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ configured: 22, source: "fallback" }),
        expect.stringContaining("CLICKHOUSE_CLIENT_REPLICAS"),
      );
    });

    /** @scenario "A known server cap bounds the fallback even when the fleet size is unknown" */
    it("keeps the default and stays quiet when the cap affords it", () => {
      process.env.CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES = "300";

      expect(getClickHouseMaxOpenConnections()).toBe(64);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});

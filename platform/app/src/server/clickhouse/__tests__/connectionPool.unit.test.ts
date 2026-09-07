import { afterEach, describe, expect, it } from "vitest";
import { getClickHouseMaxOpenConnections } from "../connectionPool";

describe("getClickHouseMaxOpenConnections", () => {
  const original = process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS;
    } else {
      process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS = original;
    }
  });

  describe("when the env var is unset", () => {
    it("returns the default of 64", () => {
      delete process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS;
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
});

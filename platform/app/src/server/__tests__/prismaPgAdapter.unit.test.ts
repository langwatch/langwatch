/**
 * specs/server/prisma-driver-adapter.feature — the pg driver adapter must
 * honor the Prisma-style URL parameters the classic engine honored. The
 * mapping is a pure function (`pgPoolConfig`), so these lock the config the
 * pool is built from rather than reaching into pg internals.
 */

import { describe, expect, it } from "vitest";
import { createPrismaPgAdapter, pgPoolConfig } from "../prismaPgAdapter";

describe("pgPoolConfig", () => {
  describe("when the URL carries a schema parameter", () => {
    /** @scenario The schema URL parameter routes both model queries and raw SQL */
    it("names the schema for model queries and the session search_path", () => {
      const config = pgPoolConfig(
        "postgresql://user:pass@localhost:5432/db?schema=langwatch_db",
      );

      expect(config.schema).toBe("langwatch_db");
      expect(config.options).toBe('-c search_path="langwatch_db"');
    });
  });

  describe("when the URL carries pool tuning parameters", () => {
    /** @scenario Pool tuning URL parameters reach the pg pool */
    it("maps connection_limit and pool_timeout onto the pg pool config", () => {
      const config = pgPoolConfig(
        "postgresql://user:pass@localhost:5432/db?connection_limit=7&pool_timeout=20",
      );

      expect(config.max).toBe(7);
      expect(config.connectionTimeoutMillis).toBe(20_000);
    });
  });

  describe("when pool parameters are absent or invalid", () => {
    /** @scenario Absent or invalid pool parameters leave pg defaults untouched */
    it("passes no overrides for a bare URL", () => {
      const config = pgPoolConfig("postgresql://user:pass@localhost:5432/db");

      expect(config).not.toHaveProperty("max");
      expect(config).not.toHaveProperty("connectionTimeoutMillis");
      expect(config).not.toHaveProperty("options");
    });

    /** @scenario Absent or invalid pool parameters leave pg defaults untouched */
    it("ignores non-numeric and non-positive values", () => {
      const config = pgPoolConfig(
        "postgresql://u:p@localhost:5432/db?connection_limit=lots&pool_timeout=0",
      );

      expect(config).not.toHaveProperty("max");
      expect(config).not.toHaveProperty("connectionTimeoutMillis");
    });
  });

  describe("when the URL is empty or malformed", () => {
    /** @scenario A malformed DATABASE_URL defers failure to first use */
    it("returns a pass-through config without throwing", () => {
      expect(pgPoolConfig("")).toEqual({
        connectionString: "",
        schema: undefined,
      });
      expect(() => createPrismaPgAdapter("not a url")).not.toThrow();
    });
  });
});

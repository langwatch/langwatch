import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ info: [] as string[], debug: [] as string[] }));
const clickhouse = vi.hoisted(() => ({
  rows: [] as unknown[],
  commands: [] as string[],
}));

vi.mock("@langwatch/observability", () => {
  const record = (bucket: string[]) => (first: unknown, second?: unknown) => {
    bucket.push(typeof first === "string" ? first : String(second ?? ""));
  };
  const logger = {
    info: record(logged.info),
    debug: record(logged.debug),
    warn: record(logged.info),
    error: record(logged.info),
    trace: record(logged.debug),
    fatal: record(logged.info),
  };
  return { createLogger: () => logger, configureLogger: () => undefined };
});

vi.mock("@clickhouse/client", () => ({
  createClient: () => ({
    query: () => Promise.resolve({ json: () => Promise.resolve(clickhouse.rows) }),
    command: ({ query }: { query: string }) => {
      clickhouse.commands.push(query);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
    ping: () => Promise.resolve({ success: true }),
  }),
}));

import { appliedMigrationVersions } from "../goose.migration-runner.ts";
import { reconcileTTL } from "../ttl.reconciler.ts";

describe("given goose has run", () => {
  describe("when the database was already at the latest migration", () => {
    /** @scenario "An idle migration run has nothing to report" */
    it("names no applied migration", () => {
      expect(appliedMigrationVersions("")).toEqual([]);
      expect(
        appliedMigrationVersions("goose: no migrations to run. current version: 88\n"),
      ).toEqual([]);
    });
  });

  describe("when it applied migrations", () => {
    /** @scenario "A migration that applied something is named" */
    it("names every one it ran", () => {
      const output = [
        "OK   00087_gateway_budget.sql (12.03ms)",
        "OK   00088_rollup_dimensions.sql (4.1ms)",
        "goose: successfully migrated database to version: 88",
      ].join("\n");

      expect(appliedMigrationVersions(output)).toEqual(["00087", "00088"]);
    });
  });
});

describe("given TTL reconciliation walks the managed tables", () => {
  beforeEach(() => {
    logged.info.length = 0;
    logged.debug.length = 0;
    clickhouse.rows = [];
    clickhouse.commands.length = 0;
  });

  describe("when no table needs a change", () => {
    /** @scenario "A table already at its intended retention is not named" */
    it("names no table at the level a person reads, and still reports the totals", async () => {
      await reconcileTTL({ connectionUrl: "http://localhost:8123/langwatch", verbose: true });

      expect(clickhouse.commands).toEqual([]);
      expect(logged.info).toEqual(["TTL reconciliation complete"]);
      expect(logged.debug.length).toBeGreaterThan(0);
    });
  });
});

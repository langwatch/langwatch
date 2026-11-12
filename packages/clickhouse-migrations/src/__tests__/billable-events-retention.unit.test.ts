import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Fail closed: a client method the test did not configure throws by name. The package has no
// test-harness dependency, so this stands in for `createApiFixture`.
const clickhouseMocks = vi.hoisted(() => {
  const unconfigured = (method: string) => () => {
    throw new Error(`ClickHouse client.${method} is not configured for this test`);
  };
  const methods = {
    query: vi.fn(unconfigured("query")),
    command: vi.fn(unconfigured("command")),
    close: vi.fn(unconfigured("close")),
  };
  const client = new Proxy(methods, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (property === "then" || typeof property === "symbol") return undefined;
      return unconfigured(String(property));
    },
  });
  return { client, methods, createClient: vi.fn(() => client) };
});

vi.mock("@clickhouse/client", () => ({
  createClient: clickhouseMocks.createClient,
}));

import { reconcileTTL, TIERED_STORAGE_POLICY } from "../ttl.reconciler.ts";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../migrations", "00128_billable_events_delete_ttl.sql"),
  "utf8",
);

const MOVE_49 = "toDateTime(EventTimestamp) + toIntervalDay(49) TO VOLUME 'cold'";
/** How ClickHouse 26 stores the clause in engine_full: interval normalised, DELETE dropped. */
const STORED_DELETE = "toDateTime(EventTimestamp) + toIntervalMonth(13)";

function givenBillableEvents({
  storagePolicy,
  ttl,
}: {
  storagePolicy: string;
  ttl: string | null;
}): void {
  clickhouseMocks.client.query.mockResolvedValue({
    json: async () => [
      {
        name: "billable_events",
        storage_policy: storagePolicy,
        engine_full:
          "ReplacingMergeTree(UpdatedAt) PARTITION BY toYYYYMM(EventTimestamp) " +
          "ORDER BY (OrganizationId, TenantId, DeduplicationKeyHash)" +
          (ttl ? ` TTL ${ttl}` : "") +
          " SETTINGS index_granularity = 8192",
      },
    ],
  });
}

function billableEventsTTLQueries(): string[] {
  return clickhouseMocks.client.command.mock.calls
    .map((call) => (call[0] as { query: string }).query)
    .filter((query) => query.includes("`billable_events` MODIFY TTL"));
}

describe("billable_events retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clickhouseMocks.client.command.mockResolvedValue(undefined);
    clickhouseMocks.client.close.mockResolvedValue(undefined);
  });

  describe("given migration 00128", () => {
    /** @scenario "A migration adds the thirteen-month DELETE to billable_events" */
    it("sets a thirteen-month DELETE on EventTimestamp without materialising it", () => {
      expect(migration).toContain(
        "MODIFY TTL toDateTime(EventTimestamp) + INTERVAL 13 MONTH DELETE",
      );
      expect(migration).toContain("materialize_ttl_after_modify = 0");
    });
  });

  describe("when the operator changes the hot days on a table that has both clauses", () => {
    /** @scenario "The reconciler keeps the DELETE when it rewrites the cold-storage MOVE" */
    it("rewrites the MOVE and keeps the thirteen-month DELETE", async () => {
      givenBillableEvents({
        storagePolicy: TIERED_STORAGE_POLICY,
        ttl: `${MOVE_49}, ${STORED_DELETE}`,
      });

      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled: true,
        hotDayOverrides: { CLICKHOUSE_COLD_STORAGE_BILLABLE_EVENTS_TTL_DAYS: "30" },
      });

      const [query] = billableEventsTTLQueries();
      expect(query).toContain(
        "toDateTime(EventTimestamp) + INTERVAL 30 DAY TO VOLUME 'cold',\n  " +
          "toDateTime(EventTimestamp) + INTERVAL 13 MONTH DELETE",
      );
      expect(query).toContain("materialize_ttl_after_modify = 0");
    });
  });

  describe("when the migration replaced the TTL with the DELETE alone", () => {
    /** @scenario "The reconciler adds the MOVE back after the migration replaced the TTL" */
    it("writes the MOVE back together with the DELETE", async () => {
      givenBillableEvents({ storagePolicy: TIERED_STORAGE_POLICY, ttl: STORED_DELETE });

      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled: true,
      });

      expect(billableEventsTTLQueries()).toEqual([
        expect.stringContaining(
          "MODIFY TTL toDateTime(EventTimestamp) + INTERVAL 49 DAY TO VOLUME 'cold',\n  " +
            "toDateTime(EventTimestamp) + INTERVAL 13 MONTH DELETE SETTINGS",
        ),
      ]);
    });
  });

  describe("when both clauses are already in place", () => {
    /** @scenario "The reconciler leaves billable_events alone once both clauses are in place" */
    it("issues no MODIFY TTL", async () => {
      givenBillableEvents({
        storagePolicy: TIERED_STORAGE_POLICY,
        ttl: `${MOVE_49}, ${STORED_DELETE}`,
      });

      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled: true,
      });

      expect(billableEventsTTLQueries()).toEqual([]);
    });
  });

  describe("when cold storage is off and the table has no TTL", () => {
    /** @scenario "Without cold storage the reconciler still installs the DELETE" */
    it("installs the DELETE alone", async () => {
      givenBillableEvents({ storagePolicy: "default", ttl: null });

      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled: false,
      });

      const queries = billableEventsTTLQueries();
      expect(queries).toEqual([
        expect.stringContaining(
          "MODIFY TTL toDateTime(EventTimestamp) + INTERVAL 13 MONTH DELETE SETTINGS",
        ),
      ]);
      expect(queries[0]).not.toContain("TO VOLUME 'cold'");
    });

    it("leaves a table that already carries the DELETE alone", async () => {
      givenBillableEvents({ storagePolicy: "default", ttl: STORED_DELETE });

      await reconcileTTL({
        connectionUrl: "http://localhost:8123/default",
        coldStorageEnabled: false,
      });

      expect(billableEventsTTLQueries()).toEqual([]);
    });
  });
});

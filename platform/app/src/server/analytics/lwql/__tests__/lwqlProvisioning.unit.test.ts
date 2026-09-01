/**
 * The settings profile, as SQL text.
 *
 * The integration suites prove the shipped profile is *accepted* by ClickHouse
 * and that a caller cannot override it. What they cannot show cheaply is which
 * ceilings the statement carries at all: a limit dropped from the emitted text
 * leaves every one of those suites green, because nothing they run comes near
 * the bound that went missing. This file is the inventory check — it fails when
 * a ceiling stops being pinned, which is the change that would otherwise ship
 * silently.
 *
 * @see ../provisioning.ts — the statements under test
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  clickHouseAccessManagementConfigXml,
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLNames,
  lwqlKeyMapTableStatement,
  lwqlRowPolicyStatement,
  lwqlSettingsProfileStatement,
} from "../provisioning";

const NAMES: LangWatchQLNames = {
  database: "lwql_unit",
  restrictedUser: "lwql_unit_reader",
  settingsProfile: "lwql_unit_profile",
  keyMapTable: "api_key_tenants",
  tenantSetting: "custom_api_key_hash",
};

/**
 * Deliberately unlike the shipped defaults, so an assertion cannot pass against
 * a statement that ignored `limits` and emitted the constants instead.
 */
const LIMITS = {
  maxExecutionTimeSeconds: 7,
  maxMemoryUsageBytes: 111_000_000,
  maxThreads: 3,
  maxConcurrentQueriesForUser: 5,
  maxRowsToRead: 222_000,
  maxBytesToRead: 333_000,
};

describe("given the LangWatchQL settings profile statement", () => {
  describe("when it is built from explicit limits", () => {
    it.each([
      ["readonly", "readonly = 1 CONST"],
      ["execution time", "max_execution_time = 7 CONST"],
      ["memory", "max_memory_usage = 111000000 CONST"],
      ["threads", "max_threads = 3 CONST"],
      ["query concurrency", "max_concurrent_queries_for_user = 5 CONST"],
      ["rows scanned", "max_rows_to_read = 222000 CONST"],
      ["bytes scanned", "max_bytes_to_read = 333000 CONST"],
      ["scan overflow", "read_overflow_mode = 'throw' CONST"],
    ])("pins the %s ceiling", (_label, expected) => {
      expect(
        lwqlSettingsProfileStatement({ names: NAMES, limits: LIMITS }),
      ).toContain(expected);
    });

    /**
     * The tenant capability is the one setting a caller may change, and its
     * empty default is what makes an absent context read zero rows rather than
     * every row. Pinning it `CONST` alongside the rest would break every
     * LangWatchQL query; leaving it changeable *without* the empty default would
     * fail open.
     */
    it("leaves only the tenant capability changeable, defaulted to empty", () => {
      const statement = lwqlSettingsProfileStatement({
        names: NAMES,
        limits: LIMITS,
      });

      expect(statement).toContain(
        `${NAMES.tenantSetting} = '' CHANGEABLE_IN_READONLY`,
      );
      expect(
        statement.match(/CHANGEABLE_IN_READONLY/g),
        "exactly one setting may be changed per query",
      ).toHaveLength(1);
    });
  });

  describe("when it is built from the shipped defaults", () => {
    it("bounds the shared identity's aggregate concurrency, not only each query", () => {
      expect(lwqlSettingsProfileStatement({ names: NAMES })).toContain(
        `max_concurrent_queries_for_user = ${DEFAULT_LWQL_RESOURCE_LIMITS.maxConcurrentQueriesForUser} CONST`,
      );
      // A ceiling of zero is ClickHouse's "unlimited", so a default that
      // drifted to 0 would read as configured while bounding nothing.
      expect(
        DEFAULT_LWQL_RESOURCE_LIMITS.maxConcurrentQueriesForUser,
      ).toBeGreaterThan(0);
    });
  });
});

/**
 * The row policy is the tenant boundary, and its `USING` clause reads a table
 * this application never writes and cannot constrain: `MergeTree ORDER BY
 * KeyHash` sorts on the hash without making it unique. A key mapped to two
 * tenants is therefore representable, and the only place that can refuse it is
 * the predicate. These assertions pin the refusal, because a predicate that
 * quietly went back to a bare `IN` would leave every integration suite green —
 * none of them writes a conflicting row.
 */
describe("given the LangWatchQL row policy", () => {
  const LWQL_TABLE = {
    table: "traces",
    tenantColumn: "TenantId",
    database: "lwql_unit",
  };

  describe("when a key hash resolves to more than one tenant", () => {
    it("admits no tenant at all, rather than every matching one", () => {
      const statement = lwqlRowPolicyStatement({
        names: NAMES,
        lwqlTable: LWQL_TABLE,
      });

      // Without this the subquery yields both rows and `IN` admits both
      // tenants, so one bad row in the key map hands a caller another
      // tenant's data. With it the group is dropped and neither is admitted.
      expect(
        statement,
        "a conflicting key map must revoke access, not widen it",
      ).toContain("HAVING uniqExact(TenantId) = 1");
    });

    it("selects the tenant only under that single-tenant guard", () => {
      const statement = lwqlRowPolicyStatement({
        names: NAMES,
        lwqlTable: LWQL_TABLE,
      });

      // `any()` is only sound because the HAVING has already proven the group
      // holds exactly one distinct tenant. Asserting the order catches a
      // rewrite that keeps the aggregate but drops the guard.
      expect(statement.indexOf("any(TenantId)")).toBeGreaterThan(-1);
      expect(
        statement.indexOf("HAVING uniqExact(TenantId) = 1"),
      ).toBeGreaterThan(statement.indexOf("any(TenantId)"));
    });
  });

  describe("when the key map table is created", () => {
    it("does not claim a uniqueness the engine will not enforce", () => {
      const statement = lwqlKeyMapTableStatement({ names: NAMES });

      // ReplacingMergeTree without an explicit version and FINAL only promises
      // eventual dedup, and the policy would read duplicates in the window
      // before a merge. If this ever becomes the engine, the predicate guard
      // above is what must still be carrying the invariant.
      expect(statement).toContain("ENGINE = MergeTree");
      expect(statement).not.toContain("ReplacingMergeTree");
    });
  });
});

/**
 * The administrative user's access-management config, as XML text.
 *
 * The `lwql_postgres` named collection holds a plaintext PostgreSQL password,
 * so `show_named_collections_secrets` would expose it through
 * `SHOW CREATE NAMED COLLECTION`. It must never be granted — parity with the
 * chart-managed renderer (`infra/clickhouse-serverless`, commit ec0005aadf) —
 * and this asserts the *absence*, which no integration suite would catch: a
 * suite that never runs `SHOW CREATE NAMED COLLECTION` stays green whether the
 * secret is exposed or not.
 */
describe("given the LangWatchQL access-management config", () => {
  describe("when it is rendered for the administrative user", () => {
    const xml = clickHouseAccessManagementConfigXml({
      administrativeUser: "lwql_admin",
    });

    it.each([
      ["access_management", "<access_management>1</access_management>"],
      [
        "named_collection_control",
        "<named_collection_control>1</named_collection_control>",
      ],
      ["show_named_collections", "<show_named_collections>1</show_named_collections>"],
    ])("grants %s", (_label, expected) => {
      expect(xml).toContain(expected);
    });

    it("does NOT grant show_named_collections_secrets (exposes lwql_postgres plaintext password)", () => {
      expect(xml).not.toContain("show_named_collections_secrets");
    });
  });
});

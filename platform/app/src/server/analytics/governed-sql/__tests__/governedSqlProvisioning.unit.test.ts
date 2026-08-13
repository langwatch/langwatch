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
 * @see specs/analytics/governed-sql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOVERNED_RESOURCE_LIMITS,
  type GovernedSqlNames,
  governedSettingsProfileStatement,
} from "../provisioning";

const NAMES: GovernedSqlNames = {
  database: "governed_unit",
  restrictedUser: "governed_unit_reader",
  settingsProfile: "governed_unit_profile",
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

describe("given the governed settings profile statement", () => {
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
        governedSettingsProfileStatement({ names: NAMES, limits: LIMITS }),
      ).toContain(expected);
    });

    /**
     * The tenant capability is the one setting a caller may change, and its
     * empty default is what makes an absent context read zero rows rather than
     * every row. Pinning it `CONST` alongside the rest would break every
     * governed query; leaving it changeable *without* the empty default would
     * fail open.
     */
    it("leaves only the tenant capability changeable, defaulted to empty", () => {
      const statement = governedSettingsProfileStatement({
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
      expect(governedSettingsProfileStatement({ names: NAMES })).toContain(
        `max_concurrent_queries_for_user = ${DEFAULT_GOVERNED_RESOURCE_LIMITS.maxConcurrentQueriesForUser} CONST`,
      );
      // A ceiling of zero is ClickHouse's "unlimited", so a default that
      // drifted to 0 would read as configured while bounding nothing.
      expect(
        DEFAULT_GOVERNED_RESOURCE_LIMITS.maxConcurrentQueriesForUser,
      ).toBeGreaterThan(0);
    });
  });
});

/**
 * The self-provisioning task is non-fatal by contract: the pod boots and the
 * LangWatchQL endpoint stays fail-closed rather than the deploy crashing. That
 * has to hold for a misconfigured connection too — a `CLICKHOUSE_URL` that
 * parses but names an invalid database identifier makes the migration URL parse
 * throw, and that throw must be caught on the same non-fatal path, not rejected
 * out of `execute()`.
 *
 * Drives the real `execute()` through env — no mocks — with a fully-configured
 * self-provision whose only fault is the database name, so the run reaches the
 * migration-URL parse (the regression path) rather than the not-configured
 * early return.
 *
 * @see ../provisionLwql.ts
 * @see specs/lwql/api.feature
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lwqlSelfProvisionFromEnv } from "../../server/analytics/lwql/provisioning";
import execute from "../provisionLwql";

const ENV_KEYS = [
  "LWQL_CLICKHOUSE_PASSWORD",
  "LWQL_POSTGRES_READER_PASSWORD",
  "CLICKHOUSE_URL",
  "LWQL_CLICKHOUSE_URL",
  "LWQL_DATABASE",
  "DATABASE_URL",
] as const;

describe("provisionLwql execute", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    // A complete self-provision configuration whose ONLY fault is the database
    // identifier in CLICKHOUSE_URL: the URL parses, the connection derives, the
    // PostgreSQL endpoint derives — everything up to the migration-URL parse.
    process.env.LWQL_CLICKHOUSE_PASSWORD = "restricted-pw";
    process.env.LWQL_POSTGRES_READER_PASSWORD = "reader-pw";
    process.env.CLICKHOUSE_URL = "http://clickhouse:8123/bad-db!";
    process.env.DATABASE_URL = "postgresql://app:app@postgres:5432/app";
    delete process.env.LWQL_CLICKHOUSE_URL;
    delete process.env.LWQL_DATABASE;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe("when CLICKHOUSE_URL parses but names an invalid database identifier", () => {
    /** @scenario "An unparsable ClickHouse database name does not crash boot" */
    it("returns without throwing instead of crashing the deploy task", async () => {
      // Precondition: the env is a fully-configured self-provision, so execute
      // gets past the not-configured early return and reaches the migration-URL
      // parse — the statement the fix moved inside the non-fatal try.
      expect(lwqlSelfProvisionFromEnv()).not.toBeNull();

      await expect(execute()).resolves.toBeUndefined();
    });
  });
});

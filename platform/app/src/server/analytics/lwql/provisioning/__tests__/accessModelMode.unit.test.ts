/**
 * LWQL_ACCESS_MODEL_MODE (#8258): `rendered` (default) ships the access model as
 * per-pod config, so the converge skips every access statement and provisions
 * only the structural objects; `sql` provisions the whole model as DDL.
 *
 * @see ../selfProvisioning.ts — lwqlAccessModelMode, selfHostedClickHouseProvisioningStatements
 * @scenario "In rendered mode the converge skips every access statement"
 * @scenario "In sql mode the converge runs the full DDL access path"
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../accessModel";
import {
  lwqlAccessModelMode,
  selfHostedClickHouseProvisioningStatements,
} from "../selfProvisioning";

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

const POSTGRES = {
  endpoint: { host: "pg.internal", port: 5432, database: "langwatch" },
  readerPassword: "reader-secret",
};

function statements({
  includeAccessStatements,
}: {
  includeAccessStatements: boolean;
}): string[] {
  return selfHostedClickHouseProvisioningStatements({
    names: NAMES,
    restrictedPassword: "restricted-secret",
    sourceDatabase: "langwatch",
    postgres: POSTGRES,
    includeAppFunctions: false,
    includeAccessStatements,
  });
}

describe("lwqlAccessModelMode", () => {
  describe("when reading LWQL_ACCESS_MODEL_MODE", () => {
    it("defaults to rendered when unset", () => {
      expect(lwqlAccessModelMode({})).toBe("rendered");
    });

    it("is sql only for the exact value sql", () => {
      expect(lwqlAccessModelMode({ LWQL_ACCESS_MODEL_MODE: "sql" })).toBe(
        "sql",
      );
    });

    it("treats rendered and any other value as rendered", () => {
      expect(lwqlAccessModelMode({ LWQL_ACCESS_MODEL_MODE: "rendered" })).toBe(
        "rendered",
      );
      expect(lwqlAccessModelMode({ LWQL_ACCESS_MODEL_MODE: "nonsense" })).toBe(
        "rendered",
      );
    });
  });
});

describe("selfHostedClickHouseProvisioningStatements access-statement gating", () => {
  describe("when rendered mode omits the access statements", () => {
    const rendered = statements({ includeAccessStatements: false });

    it("provisions the structural objects", () => {
      expect(rendered.some((s) => s.startsWith("CREATE DATABASE"))).toBe(true);
      expect(
        rendered.some((s) => s.includes("lwql_api_key_tenant_map (KeyHash")),
      ).toBe(true);
      expect(rendered.some((s) => s.includes("SQL SECURITY INVOKER"))).toBe(
        true,
      );
      expect(rendered.some((s) => s.includes("ENGINE = PostgreSQL"))).toBe(
        true,
      );
    });

    it("emits no restricted user, profile, grant, row policy or named collection", () => {
      expect(rendered.some((s) => s.includes("CREATE USER"))).toBe(false);
      expect(rendered.some((s) => s.includes("CREATE SETTINGS PROFILE"))).toBe(
        false,
      );
      expect(rendered.some((s) => s.includes("ROW POLICY"))).toBe(false);
      expect(rendered.some((s) => s.startsWith("GRANT"))).toBe(false);
      expect(rendered.some((s) => s.includes("CREATE NAMED COLLECTION"))).toBe(
        false,
      );
    });
  });

  describe("when sql mode runs the full DDL access path", () => {
    const sql = statements({ includeAccessStatements: true });

    it("emits the restricted user, profile, grants, row policies and named collection", () => {
      expect(
        sql.some((s) => s.includes("CREATE USER OR REPLACE langwatch_lwql")),
      ).toBe(true);
      expect(sql.some((s) => s.includes("CREATE SETTINGS PROFILE"))).toBe(true);
      expect(sql.some((s) => s.includes("ROW POLICY"))).toBe(true);
      expect(sql.some((s) => s.startsWith("GRANT SELECT"))).toBe(true);
      expect(
        sql.some((s) => s.includes("CREATE NAMED COLLECTION lwql_postgres")),
      ).toBe(true);
    });
  });
});

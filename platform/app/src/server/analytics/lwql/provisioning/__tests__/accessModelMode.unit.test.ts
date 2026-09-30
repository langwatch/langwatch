/**
 * LWQL_ACCESS_MODEL_MODE (#8258): `rendered` (default) ships the access model as
 * per-pod config, so the converge skips every access statement and provisions
 * only the structural objects; `sql` provisions the whole model as DDL.
 *
 * @see ../selfProvisioning.ts — lwqlAccessModelMode, selfHostedClickHouseProvisioningStatements
 * @see ../../../../start.ts — armLwqlReconvergenceWatch, gated on this mode
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../accessModel";
import {
  type LwqlAccessModelMode,
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

function statements(mode: LwqlAccessModelMode): string[] {
  return selfHostedClickHouseProvisioningStatements({
    names: NAMES,
    restrictedPassword: "restricted-secret",
    sourceDatabase: "langwatch",
    postgres: POSTGRES,
    includeAppFunctions: false,
    mode,
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

  describe("when the server decides whether to arm the reconvergence watch", () => {
    // `start.ts` arms the watch only when `lwqlAccessModelMode() === "sql"`
    // (see armLwqlReconvergenceWatch): rendered mode ships the model as per-pod
    // config, so there is no config-store→SQL-store handover to reconverge.
    /** @scenario "In rendered mode the server does not arm the reconvergence watch" */
    it("is never sql in rendered mode, the gate that skips arming", () => {
      expect(lwqlAccessModelMode({})).not.toBe("sql");
      expect(
        lwqlAccessModelMode({ LWQL_ACCESS_MODEL_MODE: "rendered" }),
      ).not.toBe("sql");
    });
  });
});

describe("selfHostedClickHouseProvisioningStatements access-statement gating", () => {
  describe("when rendered mode omits the access statements", () => {
    const rendered = statements("rendered");

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

    /** @scenario "In rendered mode the converge skips every access statement" */
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
    const sql = statements("sql");

    /** @scenario "In sql mode the converge runs the full DDL access path" */
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

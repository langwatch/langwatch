/** Rendered by default, SQL on request; each mode provisions only what it owns (ADR-159). */
import { describe, expect, it } from "vitest";

import {
  LangWatchQLSelfProvisioningService,
  type LwqlAccessModelMode,
} from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";

const selfProvisioning = LangWatchQLSelfProvisioningService.create();

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
  return selfProvisioning.clickHouseStatements({
    names: NAMES,
    restrictedPassword: "restricted-secret",
    sourceDatabase: "langwatch",
    postgres: POSTGRES,
    includeAppFunctions: false,
    mode,
  });
}

describe("the access-model mode", () => {
  describe("when reading LWQL_ACCESS_MODEL_MODE", () => {
    it("defaults to rendered when unset", () => {
      expect(selfProvisioning.accessModelMode({ source: {} })).toBe("rendered");
    });

    it("is sql only for the exact value sql", () => {
      expect(selfProvisioning.accessModelMode({ source: { LWQL_ACCESS_MODEL_MODE: "sql" } })).toBe(
        "sql",
      );
    });

    it("treats rendered and any other value as rendered", () => {
      expect(
        selfProvisioning.accessModelMode({ source: { LWQL_ACCESS_MODEL_MODE: "rendered" } }),
      ).toBe("rendered");
      expect(
        selfProvisioning.accessModelMode({ source: { LWQL_ACCESS_MODEL_MODE: "nonsense" } }),
      ).toBe("rendered");
    });
  });
});

describe("selfHostedClickHouseProvisioningStatements access-statement gating", () => {
  describe("when rendered mode omits the access statements", () => {
    const rendered = statements("rendered");

    it("provisions the structural objects", () => {
      expect(rendered.some((s) => s.startsWith("CREATE DATABASE"))).toBe(true);
      expect(rendered.some((s) => s.includes("lwql_api_key_tenant_map (KeyHash"))).toBe(true);
      expect(rendered.some((s) => s.includes("SQL SECURITY INVOKER"))).toBe(true);
      expect(rendered.some((s) => s.includes("ENGINE = PostgreSQL"))).toBe(true);
    });

    /** @scenario "In rendered mode the converge skips every access statement" */
    it("emits no restricted user, profile, grant, row policy or named collection", () => {
      expect(rendered.some((s) => s.includes("CREATE USER"))).toBe(false);
      expect(rendered.some((s) => s.includes("CREATE SETTINGS PROFILE"))).toBe(false);
      expect(rendered.some((s) => s.includes("ROW POLICY"))).toBe(false);
      expect(rendered.some((s) => s.startsWith("GRANT"))).toBe(false);
      expect(rendered.some((s) => s.includes("CREATE NAMED COLLECTION"))).toBe(false);
    });
  });

  describe("when sql mode runs the full DDL access path", () => {
    const sql = statements("sql");

    /** @scenario "In sql mode the converge runs the full DDL access path" */
    it("emits the restricted user, profile, grants, row policies and named collection", () => {
      expect(sql.some((s) => s.includes("CREATE USER OR REPLACE langwatch_lwql"))).toBe(true);
      expect(sql.some((s) => s.includes("CREATE SETTINGS PROFILE"))).toBe(true);
      expect(sql.some((s) => s.includes("ROW POLICY"))).toBe(true);
      expect(sql.some((s) => s.startsWith("GRANT SELECT"))).toBe(true);
      expect(sql.some((s) => s.includes("CREATE NAMED COLLECTION lwql_postgres"))).toBe(true);
    });
  });
});

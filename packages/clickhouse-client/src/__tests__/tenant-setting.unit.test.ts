/**
 * The tenant setting a reader read carries, computed from the request alone.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { describe, expect, it } from "vitest";

import {
  refuseTenantSettingInText,
  TENANT_IDS_SETTING,
  TenantSettingError,
  tenantSettingOf,
} from "../identity/tenantSetting.ts";
import type { QueryRequest } from "../query.ts";

const READ: QueryRequest = {
  tenantId: "project_a",
  sql: "SELECT 1 FROM trace_summaries WHERE TenantId = {tenantId:String}",
  table: "trace_summaries",
};

function violationOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    if (error instanceof TenantSettingError) return error.violation;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("tenantSettingOf()", () => {
  /** @scenario "A read sent as the app reader carries its declared tenant set as a request setting" */
  it("answers the declared tenant set, comma-separated, in its order", () => {
    expect(tenantSettingOf({ request: { ...READ, tenantIds: ["project_b", "project_a"] } })).toBe(
      "project_b,project_a",
    );
  });

  /** @scenario "A read with one tenant carries that tenant alone" */
  it("answers the request's tenant when no set is declared", () => {
    expect(tenantSettingOf({ request: READ })).toBe("project_a");
  });

  /** @scenario "A read with no tenant set is refused before it is sent" */
  it.each([
    ["an empty tenant", { ...READ, tenantId: "" }],
    ["an empty declared set", { ...READ, tenantIds: [] }],
    ["an empty id in the set", { ...READ, tenantIds: ["project_a", ""] }],
  ])("refuses %s as a missing tenant set", (_, request) => {
    expect(violationOf(() => tenantSettingOf({ request }))).toEqual({
      kind: "missing-tenant-set",
    });
  });

  /** @scenario "A tenant id carrying the setting's separator is refused" */
  it("refuses an id carrying the separator, which would split into two tenants", () => {
    expect(
      violationOf(() => tenantSettingOf({ request: { ...READ, tenantId: "project_a,project_b" } })),
    ).toEqual({ kind: "tenant-id-separator", tenantId: "project_a,project_b" });
  });

  /** @scenario "A caller's own tenant setting is refused unless it is the client's" */
  it.each([
    ["a different tenant set", { [TENANT_IDS_SETTING]: "project_b" }],
    ["the setting under another case", { sql_langwatch_tenant_ids: "project_a" }],
    ["another prefixed setting", { SQL_langwatch_tenancy_enforce: 0 }],
  ])("refuses %s supplied by the caller", (_, settings) => {
    expect(violationOf(() => tenantSettingOf({ request: { ...READ, settings } }))).toMatchObject({
      kind: "setting-supplied",
    });
  });

  /** @scenario "A caller's own tenant setting is refused unless it is the client's" */
  it("accepts the caller's tenant setting when it is exactly the computed one", () => {
    expect(
      tenantSettingOf({ request: { ...READ, settings: { [TENANT_IDS_SETTING]: "project_a" } } }),
    ).toBe("project_a");
  });
});

describe("refuseTenantSettingInText()", () => {
  /** @scenario "Statement text naming the setting prefix is refused on every identity" */
  it.each([
    "SELECT 1 SETTINGS SQL_langwatch_tenant_ids = 'project_b'",
    "SELECT * FROM (SELECT 1 SETTINGS sql_langwatch_tenant_ids = '') ",
    "SELECT getSetting('SQL_LANGWATCH_tenancy_enforce')",
  ])("refuses %s", (sql) => {
    expect(violationOf(() => refuseTenantSettingInText({ request: { ...READ, sql } }))).toEqual({
      kind: "setting-in-text",
    });
  });

  /** @scenario "Statement text naming the setting prefix is refused on every identity" */
  it("lets text that names no prefixed setting through", () => {
    expect(() => refuseTenantSettingInText({ request: READ })).not.toThrow();
  });
});

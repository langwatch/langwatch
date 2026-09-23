/**
 * The drift alarm for the tenant predicate (ADR-101): the row policy this app self-provisions and
 * the row filter the Go config renderer embeds must be the same text, or one ownership path reads
 * zero rows or over-broad rows.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LangWatchQLAccessModelService,
  LWQL_KEY_MAP_SELF_FILTER_TEMPLATE,
  LWQL_TENANT_PREDICATE_TEMPLATE,
} from "../langwatch-ql-access-model.service.ts";

const RENDER_PACKAGE = "infra/clickhouse-serverless/internal/render";

function embeddedSql(fileName: string): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, RENDER_PACKAGE))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`no ${RENDER_PACKAGE} above this test`);
    directory = parent;
  }

  return readFileSync(join(directory, RENDER_PACKAGE, fileName), "utf8").trim();
}

const NAMES = {
  database: "lwql",
  restrictedUser: "lwql_reader",
  settingsProfile: "lwql_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

describe("given the single-sourced LangWatchQL tenant predicate", () => {
  describe("when it is compared with the file the Go renderer embeds", () => {
    /** @scenario "The tenant predicate and the rendered config predicate are the same text" */
    it("is byte-identical to lwqlTenantPredicate.sql", () => {
      expect(LWQL_TENANT_PREDICATE_TEMPLATE).toBe(embeddedSql("lwqlTenantPredicate.sql"));
    });

    /** @scenario "The tenant predicate and the rendered config predicate are the same text" */
    it("is byte-identical to lwqlKeyMapSelfFilter.sql", () => {
      expect(LWQL_KEY_MAP_SELF_FILTER_TEMPLATE).toBe(embeddedSql("lwqlKeyMapSelfFilter.sql"));
    });
  });

  describe("when the row policies are rendered", () => {
    const accessModel = LangWatchQLAccessModelService.create();

    it("admits a row through set membership of the capability, one hash at a time", () => {
      const statement = accessModel.rowPolicyStatement({
        names: NAMES,
        lwqlTable: { table: "traces", tenantColumn: "TenantId" },
      });

      expect(statement).toContain(
        "TenantId IN (SELECT any(TenantId) FROM lwql.lwql_api_key_tenant_map " +
          "WHERE has(splitByChar(',', getSetting('custom_api_key_hash')), KeyHash) " +
          "GROUP BY KeyHash HAVING uniqExact(TenantId) = 1)",
      );
    });

    it("lets the key map show a caller only the rows its own hash set names", () => {
      expect(accessModel.keyMapRowPolicyStatement({ names: NAMES })).toContain(
        "USING has(splitByChar(',', getSetting('custom_api_key_hash')), KeyHash)",
      );
    });
  });
});

/**
 * The spend filters as builder conditions: one bound predicate per filter present, rendered
 * after the tenant predicate. Moved here from the rules test when the SQL strings went.
 */
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import type { SpendFilters } from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import { spendFilterConditions } from "../clickhouse.gateway-spend-query.mapper.ts";
import { gatewaySpend as spend } from "../clickhouse.gateway-spend.table.ts";

const TENANT_PREDICATE = "WHERE TenantId = {tenantId:String}";

function rendered(filters: SpendFilters) {
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: "project-1" }) })
    .from(spend)
    .select({ GatewayRequestId: spend.GatewayRequestId });
  for (const condition of spendFilterConditions({ filters })) read = read.where(condition);
  const { sql, params } = read.build();
  const { tenantId: _tenant, ...bound } = params;
  return { where: sql.slice(sql.indexOf(TENANT_PREDICATE) + TENANT_PREDICATE.length), bound };
}

describe("spendFilterConditions", () => {
  describe("when one filter is present", () => {
    it("emits one bound predicate for it", () => {
      expect(rendered({ models: ["gpt-5-mini"] })).toEqual({
        where: " AND Model IN ({v0:Array(String)})",
        bound: { v0: ["gpt-5-mini"] },
      });
    });
  });

  describe("when a present filter is empty", () => {
    it("still emits the predicate", () => {
      // A team with no projects, or an external id nobody minted, must answer
      // nothing, not collapse into an absent predicate and hand back the
      // organization's entire spend.
      expect(rendered({ virtualKeyIds: [] })).toEqual({
        where: " AND VirtualKeyId IN ({v0:Array(String)})",
        bound: { v0: [] },
      });
    });
  });

  describe("when labels are named", () => {
    it("matches a label against any of the values named", () => {
      expect(rendered({ labels: ["tier:gold"] }).where).toBe(
        " AND hasAny(Labels, {v0:Array(String)})",
      );
    });
  });

  describe("when metadata pairs are named", () => {
    it("binds each key and its values as their own parameters", () => {
      expect(
        rendered({
          metadata: [
            { key: "tier", values: ["gold"] },
            { key: "region", values: ["eu", "us"] },
          ],
        }),
      ).toEqual({
        where:
          " AND MetadataMap[{v0:String}] IN ({v1:Array(String)})" +
          " AND MetadataMap[{v2:String}] IN ({v3:Array(String)})",
        bound: { v0: "tier", v1: ["gold"], v2: "region", v3: ["eu", "us"] },
      });
    });
  });

  describe("when the legacy status vocabulary is used", () => {
    it("maps it onto lifecycle statuses", () => {
      expect(rendered({ status: "success" })).toEqual({
        where: " AND Status = {v0:String}",
        bound: { v0: "confirmed" },
      });
    });
  });
});

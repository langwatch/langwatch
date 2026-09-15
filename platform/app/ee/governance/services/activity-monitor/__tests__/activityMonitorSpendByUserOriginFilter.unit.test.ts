// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Scope decides the population twice over, and only one half is visible from
 * the service.
 *
 * The tenant list is an argument the service builds, so a test above the
 * repository can see it. The second half is not: `findSpendByUser` also
 * filters `Attributes['langwatch.origin.kind'] = 'ingestion_source'`, which
 * keeps the read to traffic that arrived through a governance ingestion
 * source. `findSpendByDepartment`, the panel that sits beside it on the cost
 * screen, carries no such filter. Two panels over the same table reporting the
 * same unit therefore still disagree even once both are handed every project
 * of the organization, because one of them drops every row that did not arrive
 * through a source. The filter has to move with the scope, and it lives in
 * SQL, so this is the only level that can hold it.
 *
 * The assertions run against the SQL production would actually send — the real
 * repository, its production constructor contract, a mock client — rather than
 * against a stub, for the same reason as `activityMonitorSpendQueryBounds`.
 *
 * THE ORDER BY IS NOT CALLER TEXT. The scope is a code branch; the sort key
 * stays a lookup into `SORT_FIELD_TO_AGG_EXPR`. The last test here pins that:
 * nothing about adding a scope may turn the whitelist into interpolation.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "A people panel
 * measures tokens and says which store it read".
 */
import { describe, expect, it, vi } from "vitest";

import type { SpendByUserScope } from "../activityMonitor.clickhouse.schemas";
import { ActivityMonitorSpendClickHouseRepository } from "../activityMonitor.spend.clickhouse.repository";

/** The real repository over a mock ClickHouse client, plus the capturing spy. */
function makeRepo() {
  const query = vi.fn(async () => ({ json: async () => [] as unknown[] }));
  const ch = { query } as never;
  const repo = new ActivityMonitorSpendClickHouseRepository(async () => ch);
  return { repo, query };
}

type CapturedCall = {
  query: string;
  query_params: Record<string, unknown>;
};

const captured = (query: { mock: { calls: unknown[][] } }): CapturedCall =>
  query.mock.calls[0]?.[0] as CapturedCall;

const WINDOW_START = Date.UTC(2026, 0, 1);
const WINDOW_END = Date.UTC(2026, 1, 1);

const readWith = async (scope: SpendByUserScope) => {
  const { repo, query } = makeRepo();
  await repo.findSpendByUser({
    tenantIds:
      scope === "organization"
        ? ["project-assistants", "project-support-desk"]
        : ["project-governance"],
    scope,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    sortBy: "tokens",
    sortDir: "desc",
    limit: 8,
    offset: 0,
  });
  return captured(query);
};

describe("the per-person spend read's scope", () => {
  describe("given the governance scope", () => {
    /** @scenario "A reader of the person figures other than the cost screen keeps the governance scope" */
    it("keeps the read to traffic that arrived through a governance source", async () => {
      const call = await readWith("governance");

      expect(call.query).toContain("{originKey:String}");
      expect(call.query_params.originValue).toBe("ingestion_source");
    });

    /** @scenario "A reader of the person figures other than the cost screen keeps the governance scope" */
    it("scopes to the one governance project", async () => {
      const call = await readWith("governance");

      expect(call.query_params.tenantId).toBe("project-governance");
      // Both halves of the read carry the tenant, outer query and dedup
      // subquery, or the subquery dedups across the whole store.
      const occurrences = call.query.match(/\{tenantId:String\}/g) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("given the organization scope", () => {
    /** @scenario "The panel counting people covers every project of the organization" */
    it("drops the source filter, matching the department read beside it", async () => {
      const call = await readWith("organization");

      expect(call.query).not.toContain("{originKey:String}");
      expect(call.query_params).not.toHaveProperty("originValue");
    });

    /** @scenario "The panel counting people covers every project of the organization" */
    it("scopes to every project it was handed, in both halves of the read", async () => {
      const call = await readWith("organization");

      expect(call.query_params.tenantIds).toEqual([
        "project-assistants",
        "project-support-desk",
      ]);
      const occurrences =
        call.query.match(/\{tenantIds:Array\(String\)\}/g) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("given either scope", () => {
    /** @scenario "The panel counting people covers every project of the organization" */
    it("orders by a whitelisted expression, never by caller text", async () => {
      for (const scope of ["governance", "organization"] as const) {
        const call = await readWith(scope);

        // The sort field crossed a tRPC boundary as the string "tokens"; what
        // reaches the ORDER BY is the aggregate the whitelist maps it to.
        expect(call.query).not.toMatch(/ORDER BY\s+tokens\b/);
        expect(call.query).toMatch(/ORDER BY\s+sum\(/);
      }
    });
  });
});

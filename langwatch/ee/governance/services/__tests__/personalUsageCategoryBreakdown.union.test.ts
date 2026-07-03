/**
 * @vitest-environment node
 *
 * PersonalUsageService.breakdownByCategory — ingestion-source union control
 * flow (ADR-033 PR D). These are unit tests over a mocked ClickHouse client:
 * they assert WHEN the second (gov-tenant) query fires, that its results merge
 * into the personal rows, and that a union failure degrades to personal-only
 * rather than blanking the view. The real query shape is covered end-to-end by
 * personalUsageCategoryBreakdown.service.integration.test.ts.
 *
 * Spec: specs/ai-gateway/governance/cost-breakdown-dashboard.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORIES,
  type Category,
} from "~/server/app-layer/traces/block-classification/categories";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(async () => ({ query: queryMock })),
  isClickHouseEnabled: () => true,
}));

import { PersonalUsageService } from "../personalUsage.service";

const window = {
  start: new Date(Date.UTC(2026, 0, 1)),
  end: new Date(Date.UTC(2026, 0, 31)),
};

/** Build the single aggregate row the outer query returns for the given cats. */
function rowFor(
  entries: Partial<Record<Category, { cost: number; tokens: number }>>,
): Record<string, number> {
  const row: Record<string, number> = {};
  CATEGORIES.forEach((category, i) => {
    row[`scost_${i}`] = entries[category]?.cost ?? 0;
    row[`stok_${i}`] = entries[category]?.tokens ?? 0;
  });
  return row;
}

const jsonResult = (row: Record<string, number>) => ({
  json: async () => [row],
});

describe("PersonalUsageService.breakdownByCategory ingestion union", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  describe("given only a personal project (no userEmail / ingestionTenantId)", () => {
    it("issues a single query and returns the personal-tenant rows only", async () => {
      queryMock.mockResolvedValue(
        jsonResult(rowFor({ system_prompt: { cost: 0.8, tokens: 800 } })),
      );

      const rows = await new PersonalUsageService().breakdownByCategory({
        personalProjectId: "personal",
        window,
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(rows).toEqual([
        { category: "system_prompt", costUsd: 0.8, tokens: 800 },
      ]);
    });
  });

  describe("given userEmail + ingestionTenantId", () => {
    it("issues a second gov-tenant query filtered by principal email and merges the totals", async () => {
      queryMock.mockImplementation(
        async ({
          query_params,
        }: {
          query_params: Record<string, string | number>;
        }) =>
          query_params.tenantId === "gov"
            ? jsonResult(rowFor({ system_prompt: { cost: 0.5, tokens: 500 } }))
            : jsonResult(rowFor({ system_prompt: { cost: 0.8, tokens: 800 } })),
      );

      const rows = await new PersonalUsageService().breakdownByCategory({
        personalProjectId: "personal",
        ingestionTenantId: "gov",
        userEmail: "me@example.com",
        window,
      });

      expect(queryMock).toHaveBeenCalledTimes(2);
      // The gov query carries the principal-email predicate + bound param.
      const govCall = queryMock.mock.calls.find(
        ([arg]) => arg.query_params.tenantId === "gov",
      );
      expect(govCall?.[0].query).toContain(
        "Attributes[{userKey:String}] = {userEmail:String}",
      );
      expect(govCall?.[0].query_params.userEmail).toBe("me@example.com");
      // Merged: personal 0.8 + gov 0.5 = 1.3 / 800 + 500 = 1300.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.category).toBe("system_prompt");
      expect(rows[0]?.costUsd).toBeCloseTo(1.3, 10);
      expect(rows[0]?.tokens).toBe(1300);
    });
  });

  describe("given the gov-tenant union query fails", () => {
    it("degrades to the personal-tenant rows instead of surfacing the error", async () => {
      queryMock.mockImplementation(
        async ({
          query_params,
        }: {
          query_params: Record<string, string | number>;
        }) => {
          if (query_params.tenantId === "gov") throw new Error("CH down");
          return jsonResult(
            rowFor({ system_prompt: { cost: 0.8, tokens: 800 } }),
          );
        },
      );

      const rows = await new PersonalUsageService().breakdownByCategory({
        personalProjectId: "personal",
        ingestionTenantId: "gov",
        userEmail: "me@example.com",
        window,
      });

      expect(rows).toEqual([
        { category: "system_prompt", costUsd: 0.8, tokens: 800 },
      ]);
    });
  });
});

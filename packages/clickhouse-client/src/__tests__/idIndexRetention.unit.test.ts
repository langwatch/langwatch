/**
 * The id index retention raise's parameters: one statement per index and target, split only past
 * the URL budget. Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it } from "vitest";

import { idIndexRetentionRaises } from "../idIndexRetention.ts";

describe("idIndexRetentionRaises", () => {
  describe("given tenants of differing retention", () => {
    /** @scenario "a retention raise is one statement per index, never lowering a row" */
    it("binds every tenant to its own days in one raise, a source's 0 as kept forever", () => {
      const raises = idIndexRetentionRaises({
        daysByTenant: new Map([
          ["project-b", 30],
          ["project-a", 0],
          ["project-c", 365],
        ]),
      });

      expect(raises).toEqual([
        { tenantIds: ["project-a", "project-b", "project-c"], retentionDays: [65_535, 30, 365] },
      ]);
    });
  });

  describe("given more tenant ids than one URL carries", () => {
    it("splits the raise only at the byte budget, not per retention value", () => {
      const daysByTenant = new Map(
        Array.from({ length: 30 }, (_, at) => [`project-${String(at).padStart(2, "0")}`, at % 3]),
      );

      const raises = idIndexRetentionRaises({ daysByTenant, paramBytes: 260 });

      expect(raises.map((each) => each.tenantIds.length)).toEqual([10, 10, 10]);
      expect(idIndexRetentionRaises({ daysByTenant })).toHaveLength(1);
    });
  });
});

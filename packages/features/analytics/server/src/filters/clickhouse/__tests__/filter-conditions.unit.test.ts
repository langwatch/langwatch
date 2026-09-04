/**
 * clickHouseFilterConditions builders that translate a filter field's
 * selected values into raw ClickHouse SQL fragments.
 *
 * Lifted from `platform/app/src/server/filters/__tests__/filter-conditions.test.ts`
 * (deleted with `platform/app`); the builders live in this package now.
 *
 * Spec: specs/traces/saved-views.feature
 */
import { describe, expect, it } from "vitest";
import { clickHouseFilterConditions } from "../filter-conditions";

describe("clickHouseFilterConditions", () => {
  describe("traces.origin", () => {
    const expectedSql =
      "if(ifNull(ts.Attributes['langwatch.origin'], '') = '', 'application', ts.Attributes['langwatch.origin']) IN ({f0_values:Array(String)})";

    /** @scenario 'ClickHouse origin aggregation labels empty values as "application"' */
    it("maps empty/NULL origins to 'application' via ifNull, matching the dropdown", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      expect(builder).not.toBeNull();
      const result = builder!(["application"], "f0");
      expect(result.sql).toBe(expectedSql);
      expect(result.params).toEqual({ f0_values: ["application"] });
    });

    it("passes non-application values through directly", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!(["evaluation"], "f0");
      expect(result.sql).toBe(expectedSql);
      expect(result.params).toEqual({ f0_values: ["evaluation"] });
    });

    it("handles mixed application and other values", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!(["application", "evaluation"], "f0");
      expect(result.sql).toBe(expectedSql);
      expect(result.params).toEqual({
        f0_values: ["application", "evaluation"],
      });
    });

    it("returns 1=0 when no values selected", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!([], "f0");
      expect(result.sql).toBe("1=0");
    });
  });
});

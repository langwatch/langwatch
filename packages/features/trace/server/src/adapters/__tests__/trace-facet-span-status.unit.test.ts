import { ClickHouseFacetRegistryAdapter } from "../trace-facet-registry.clickhouse.adapter";
import { ClickHouseSpanStatusFacetAdapter } from "../trace-facet-span-status.clickhouse.adapter";
import { describe, expect, it } from "vitest";

describe("ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET", () => {
  it("is a categorical cross-table facet against stored_spans", () => {
    expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.kind).toBe("categorical");
    expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.table).toBe("stored_spans");
    expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.group).toBe("span");
    expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.key).toBe("spanStatus");
  });

  describe("status code expression", () => {
    it("maps OTel status code 2 to 'error'", () => {
      expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.expression).toContain(
        "= 2, 'error'",
      );
    });

    it("maps OTel status code 1 to 'ok'", () => {
      expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.expression).toContain("= 1, 'ok'");
    });

    it("coalesces a NULL status before comparing it", () => {
      // `StatusCode` is Nullable(UInt8), and in ClickHouse a comparison
      // against NULL evaluates to NULL — so `if(StatusCode = 2, ...)` returns
      // NULL for a NULL-status span rather than falling through to 'unset',
      // dropping the span out of the filter entirely. Every read of the
      // column must therefore be NULL-coalesced before it is compared.
      const bareComparisons =
        ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.expression.match(
          /(?<!ifNull\()StatusCode\s*=/g,
        ) ?? [];

      expect(bareComparisons).toEqual([]);
      expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.expression).toContain(
        "ifNull(StatusCode, 0)",
      );
    });

    it("treats a coalesced-to-zero status as 'unset'", () => {
      expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.expression).toContain("'unset'");
    });

    it("doesn't accidentally swap the OK / ERROR codes (regression guard)", () => {
      // Anchors against the literal expression so a future copy/paste edit
      // that flips the code → label mapping fails loudly.
      expect(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET.expression).toBe(
        "if(ifNull(StatusCode, 0) = 2, 'error', if(ifNull(StatusCode, 0) = 1, 'ok', 'unset'))",
      );
    });
  });

  it("registers the spanStatus key into ClickHouseFacetRegistryAdapter.FACET_REGISTRY exactly once", () => {
    const matches = ClickHouseFacetRegistryAdapter.FACET_REGISTRY.filter(
      (d) => d.key === "spanStatus",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(ClickHouseSpanStatusFacetAdapter.SPAN_STATUS_FACET);
  });
});

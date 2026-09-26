import { describe, expect, it } from "vitest";

import { FACET_REGISTRY } from "../../../rules/trace-facet-registry.rules.ts";
import { ClickHouseTraceFacetSpanStatusRepository } from "../clickhouse.trace-facet-span-status.repository.ts";

const spanStatusFacet = ClickHouseTraceFacetSpanStatusRepository.create().getSpanStatusFacet();

describe("ClickHouseTraceFacetSpanStatusRepository.getSpanStatusFacet", () => {
  it("is a categorical cross-table facet against stored_spans", () => {
    expect(spanStatusFacet.kind).toBe("categorical");
    expect(spanStatusFacet.table).toBe("stored_spans");
    expect(spanStatusFacet.group).toBe("span");
    expect(spanStatusFacet.key).toBe("spanStatus");
  });

  describe("given the status code expression", () => {
    it("maps OTel status code 2 to 'error'", () => {
      expect(spanStatusFacet.expression).toContain("= 2, 'error'");
    });

    it("maps OTel status code 1 to 'ok'", () => {
      expect(spanStatusFacet.expression).toContain("= 1, 'ok'");
    });

    it("coalesces a NULL status before comparing it", () => {
      // `StatusCode` is Nullable(UInt8), and in ClickHouse a comparison
      // against NULL evaluates to NULL — so `if(StatusCode = 2, ...)` returns
      // NULL for a NULL-status span rather than falling through to 'unset',
      // dropping the span out of the filter entirely. Every read of the
      // column must therefore be NULL-coalesced before it is compared.
      const bareComparisons =
        spanStatusFacet.expression.match(/(?<!ifNull\()StatusCode\s*=/g) ?? [];

      expect(bareComparisons).toEqual([]);
      expect(spanStatusFacet.expression).toContain("ifNull(StatusCode, 0)");
    });

    it("treats a coalesced-to-zero status as 'unset'", () => {
      expect(spanStatusFacet.expression).toContain("'unset'");
    });

    it("doesn't accidentally swap the OK / ERROR codes (regression guard)", () => {
      // Anchors against the literal expression so a future copy/paste edit
      // that flips the code → label mapping fails loudly.
      expect(spanStatusFacet.expression).toBe(
        "if(ifNull(StatusCode, 0) = 2, 'error', if(ifNull(StatusCode, 0) = 1, 'ok', 'unset'))",
      );
    });
  });

  it("registers the spanStatus key into FACET_REGISTRY exactly once", () => {
    const matches = FACET_REGISTRY.filter((d) => d.key === "spanStatus");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(spanStatusFacet);
  });
});

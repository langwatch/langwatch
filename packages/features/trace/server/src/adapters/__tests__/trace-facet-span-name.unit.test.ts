import { ClickHouseFacetRegistryAdapter } from "../trace-facet-registry.clickhouse.adapter";
import { ClickHouseSpanNameFacetAdapter } from "../trace-facet-span-name.clickhouse.adapter";
import { describe, expect, it } from "vitest";

describe("ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET", () => {
  it("is a categorical expression facet against stored_spans", () => {
    expect(ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET.kind).toBe("categorical");
    expect(ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET.table).toBe("stored_spans");
    expect(ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET.group).toBe("span");
  });

  it("reads the SpanName column directly (no rollup, no arrayJoin)", () => {
    expect(ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET.expression).toBe("SpanName");
  });

  it("registers the spanName key into ClickHouseFacetRegistryAdapter.FACET_REGISTRY exactly once", () => {
    const matches = ClickHouseFacetRegistryAdapter.FACET_REGISTRY.filter(
      (d) => d.key === "spanName",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET);
  });

  it("uses a key the search bar / sidebar can round-trip ('spanName')", () => {
    expect(ClickHouseSpanNameFacetAdapter.SPAN_NAME_FACET.key).toBe("spanName");
  });
});

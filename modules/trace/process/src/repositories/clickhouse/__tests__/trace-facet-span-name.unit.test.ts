import { describe, expect, it } from "vitest";

import { ClickHouseFacetRegistryAdapter } from "../clickhouse.trace-facet-registry.repository.ts";
import { ClickHouseTraceFacetSpanNameRepository } from "../clickhouse.trace-facet-span-name.repository.ts";

const spanNameFacet = ClickHouseTraceFacetSpanNameRepository.create().getSpanNameFacet();

describe("ClickHouseTraceFacetSpanNameRepository.getSpanNameFacet", () => {
  it("is a categorical expression facet against stored_spans", () => {
    expect(spanNameFacet.kind).toBe("categorical");
    expect(spanNameFacet.table).toBe("stored_spans");
    expect(spanNameFacet.group).toBe("span");
  });

  it("reads the SpanName column directly (no rollup, no arrayJoin)", () => {
    expect(spanNameFacet.expression).toBe("SpanName");
  });

  it("registers the spanName key into ClickHouseFacetRegistryAdapter.FACET_REGISTRY exactly once", () => {
    const matches = ClickHouseFacetRegistryAdapter.FACET_REGISTRY.filter(
      (d) => d.key === "spanName",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(spanNameFacet);
  });

  it("uses a key the search bar / sidebar can round-trip ('spanName')", () => {
    expect(spanNameFacet.key).toBe("spanName");
  });
});

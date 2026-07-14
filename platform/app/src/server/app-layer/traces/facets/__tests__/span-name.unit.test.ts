import { describe, expect, it } from "vitest";
import { FACET_REGISTRY } from "../../facet-registry";
import { SPAN_NAME_FACET } from "../span-name";

describe("SPAN_NAME_FACET", () => {
  it("is a categorical expression facet against stored_spans", () => {
    expect(SPAN_NAME_FACET.kind).toBe("categorical");
    expect(SPAN_NAME_FACET.table).toBe("stored_spans");
    expect(SPAN_NAME_FACET.group).toBe("span");
  });

  it("reads the SpanName column directly (no rollup, no arrayJoin)", () => {
    expect(SPAN_NAME_FACET.expression).toBe("SpanName");
  });

  it("registers the spanName key into FACET_REGISTRY exactly once", () => {
    const matches = FACET_REGISTRY.filter((d) => d.key === "spanName");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(SPAN_NAME_FACET);
  });

  it("uses a key the search bar / sidebar can round-trip ('spanName')", () => {
    expect(SPAN_NAME_FACET.key).toBe("spanName");
  });
});

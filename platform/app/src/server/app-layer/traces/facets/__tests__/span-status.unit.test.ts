import { describe, expect, it } from "vitest";
import { FACET_REGISTRY } from "../../facet-registry";
import { SPAN_STATUS_FACET } from "../span-status";

describe("SPAN_STATUS_FACET", () => {
  it("is a categorical cross-table facet against stored_spans", () => {
    expect(SPAN_STATUS_FACET.kind).toBe("categorical");
    expect(SPAN_STATUS_FACET.table).toBe("stored_spans");
    expect(SPAN_STATUS_FACET.group).toBe("span");
    expect(SPAN_STATUS_FACET.key).toBe("spanStatus");
  });

  describe("status code expression", () => {
    it("maps OTel status code 2 to 'error'", () => {
      expect(SPAN_STATUS_FACET.expression).toContain("StatusCode = 2");
      expect(SPAN_STATUS_FACET.expression).toContain("'error'");
    });

    it("maps OTel status code 1 to 'ok'", () => {
      expect(SPAN_STATUS_FACET.expression).toContain("StatusCode = 1");
      expect(SPAN_STATUS_FACET.expression).toContain("'ok'");
    });

    it("treats null / missing status as 'unset'", () => {
      // NULL == anything is false in CH; the outer `if(_, _, 'unset')` arm
      // catches both `0` and `NULL`, which is the desired OTel semantic.
      expect(SPAN_STATUS_FACET.expression).toContain("'unset'");
    });

    it("doesn't accidentally swap the OK / ERROR codes (regression guard)", () => {
      // Anchors against the literal expression so a future copy/paste edit
      // that flips the code → label mapping fails loudly.
      expect(SPAN_STATUS_FACET.expression).toBe(
        "if(StatusCode = 2, 'error', if(StatusCode = 1, 'ok', 'unset'))",
      );
    });
  });

  it("registers the spanStatus key into FACET_REGISTRY exactly once", () => {
    const matches = FACET_REGISTRY.filter((d) => d.key === "spanStatus");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(SPAN_STATUS_FACET);
  });
});

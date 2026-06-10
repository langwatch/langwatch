import { describe, expect, it } from "vitest";
import { FACET_COLORS } from "../../components/FilterSidebar/constants";
import { facetLabel, paletteFromColor } from "../../components/FilterSidebar/utils";
import { OriginCell } from "../../components/TraceTable/registry/cells/trace/SimpleCells";
import type { TraceListItem } from "../../types/trace";
import { ORIGIN_DISPLAY, originColorPalette, originLabel } from "../originDisplay";

const knownOrigins = Object.keys(ORIGIN_DISPLAY) as Array<
  keyof typeof ORIGIN_DISPLAY
>;

function renderOriginBadge(origin: string) {
  return OriginCell.render({
    row: { origin } as TraceListItem,
  } as Parameters<typeof OriginCell.render>[0]);
}

describe("origin display mapping", () => {
  describe("when the sidebar renders origin facet rows", () => {
    it.each(knownOrigins)("labels %s from the shared table", (origin) => {
      expect(facetLabel(origin, "origin")).toBe(ORIGIN_DISPLAY[origin].label);
    });

    it.each(knownOrigins)("colours the %s dot from the shared table", (origin) => {
      const dotColor = FACET_COLORS.origin![origin];
      expect(paletteFromColor(dotColor)).toBe(
        ORIGIN_DISPLAY[origin].colorPalette,
      );
    });
  });

  describe("when the table renders the Origin column badge", () => {
    it.each(knownOrigins)(
      "labels and colours the %s badge from the shared table",
      (origin) => {
        const badge = renderOriginBadge(origin);
        expect(badge.props.children).toBe(ORIGIN_DISPLAY[origin].label);
        expect(badge.props.colorPalette).toBe(
          ORIGIN_DISPLAY[origin].colorPalette,
        );
      },
    );
  });

  describe("when an unknown origin value arrives", () => {
    it("passes the value through with a neutral palette", () => {
      expect(originLabel("mystery")).toBe("mystery");
      expect(originColorPalette("mystery")).toBe("gray");
    });
  });
});

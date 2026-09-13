/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterDisplay } from "../FilterDisplay";

const renderFilters = ({
  filters,
  shouldClampValues,
}: {
  filters: Record<string, unknown>;
  shouldClampValues?: boolean;
}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FilterDisplay
        filters={filters}
        hasBorder={true}
        {...(shouldClampValues === undefined ? {} : { shouldClampValues })}
      />
    </ChakraProvider>,
  );

// One unbreakable token, the shape of a monitor id. Without min-width: 0 on
// the flex child, its min-content width beats the chip's border and the text
// bleeds into the next table column.
const LONG_VALUE = "monitor_0008KDW6ykSweqn6dwR0UukEOi2wAbCdEfGhIjKlMnOpQrSt";

const LONG_FILTER = { "trace_checks.check_id": [LONG_VALUE] };

describe("FilterDisplay", () => {
  afterEach(() => cleanup());

  describe("given a filter value is one long unbreakable token", () => {
    describe("when the chip clamps its values", () => {
      it("lets the value's flex child shrink below its content width", () => {
        renderFilters({ filters: LONG_FILTER });

        const text = screen.getByText(LONG_VALUE);
        // The clamped text box sits inside FilterValue's Box, the flex child of
        // the chip's HStack. Flex children default to min-width: auto, which is
        // the defect: the chip cannot shrink it, so it must opt out.
        const flexChild = text.closest("div")?.parentElement;
        expect(flexChild).toBeTruthy();
        const style = getComputedStyle(flexChild!);
        expect(style.minWidth).toBe("0px");
        expect(style.overflow).toBe("hidden");
      });

      it("keeps the value clamped to one line inside the chip", () => {
        renderFilters({ filters: LONG_FILTER });

        const text = screen.getByText(LONG_VALUE);
        const clamped = getComputedStyle(text.closest("div")!);
        expect(clamped.webkitLineClamp).toBe("1");
      });
    });

    // The graph filter indicator renders this inside a tooltip, where clamping
    // hides the rest of the value behind a hover the user cannot perform.
    describe("when clamping is turned off", () => {
      it("wraps the value instead of clamping it to one line", () => {
        renderFilters({ filters: LONG_FILTER, shouldClampValues: false });

        const style = getComputedStyle(screen.getByText(LONG_VALUE));
        // Asserted as absent rather than "not 1": a negative assertion would
        // also pass if the styles had never applied at all.
        expect(style.webkitLineClamp).toBe("");
        expect(style.overflow).toBe("");
      });

      it("breaks mid-token so an unbreakable id cannot run past its container", () => {
        renderFilters({ filters: LONG_FILTER, shouldClampValues: false });

        const style = getComputedStyle(screen.getByText(LONG_VALUE));
        expect(style.overflowWrap).toBe("anywhere");
        expect(style.minWidth).toBe("0px");
      });
    });
  });
});

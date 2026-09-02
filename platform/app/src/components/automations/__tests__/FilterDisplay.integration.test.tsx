/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterDisplay } from "../FilterDisplay";

const renderFilters = (filters: Record<string, unknown>) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FilterDisplay filters={filters} hasBorder={true} />
    </ChakraProvider>,
  );

// One unbreakable token, the shape of a monitor id. Without min-width: 0 on
// the flex child, its min-content width beats the chip's border and the text
// bleeds into the next table column.
const LONG_VALUE = "monitor_0008KDW6ykSweqn6dwR0UukEOi2wAbCdEfGhIjKlMnOpQrSt";

describe("FilterDisplay", () => {
  afterEach(() => cleanup());

  describe("when a filter value is one long unbreakable token", () => {
    it("lets the value's flex child shrink below its content width", () => {
      renderFilters({ "trace_checks.check_id": [LONG_VALUE] });

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
      renderFilters({ "trace_checks.check_id": [LONG_VALUE] });

      const text = screen.getByText(LONG_VALUE);
      const clamped = getComputedStyle(text.closest("div")!);
      expect(clamped.webkitLineClamp).toBe("1");
    });
  });
});

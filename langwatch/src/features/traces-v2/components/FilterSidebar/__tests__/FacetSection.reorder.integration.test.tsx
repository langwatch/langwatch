/**
 * @vitest-environment jsdom
 *
 * Facet rows must not reorder under the cursor. Clicking a value used to yank
 * it up to the pinned/active area (and the post-filter count re-sort shuffled
 * the rest), which was jarring mid-interaction. FacetSection freezes the
 * rendered order while the pointer is inside the section and only re-flows
 * once the pointer leaves.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Compass } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// FacetSection now calls useFacetSearch (server-side value search) at the top
// level. This suite renders FacetSection without a tRPC provider, so stub the
// hook out — server search has its own dedicated suite
// (FacetSection.serverSearch.integration.test.tsx).
vi.mock("../../../hooks/useFacetSearch", () => ({
  useFacetSearch: () => ({ values: [], totalDistinct: 0, isLoading: false }),
}));

import { FacetSection } from "../FacetSection";
import type { FacetItem, FacetValueState } from "../types";

afterEach(() => cleanup());

// Three values < AUTO_EXPAND_THRESHOLD (5) so the section auto-expands and the
// body rows render. Counts are descending so the unfrozen sort order is a,b,c.
const ITEMS: FacetItem[] = [
  { value: "a", label: "Alpha", count: 10 },
  { value: "b", label: "Bravo", count: 5 },
  { value: "c", label: "Charlie", count: 2 },
];

const tree = (activeValues: ReadonlySet<string>) => {
  const getValueState = (value: string): FacetValueState =>
    activeValues.has(value) ? "include" : "neutral";
  return (
    <ChakraProvider value={defaultSystem}>
      <FacetSection
        title="ORIGIN"
        icon={Compass}
        field="origin"
        items={ITEMS}
        getValueState={getValueState}
        onToggle={vi.fn()}
        onExclude={vi.fn()}
      />
    </ChakraProvider>
  );
};

const valueOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("[data-facet-value]")).map(
    (el) => el.getAttribute("data-facet-value") ?? "",
  );

// React synthesises onMouseEnter/Leave from the native over/out events, so
// fire both to drive the handlers regardless of jsdom's event plumbing.
const enterSection = (el: Element) => {
  fireEvent.mouseOver(el);
  fireEvent.mouseEnter(el);
};
const leaveSection = (el: Element) => {
  fireEvent.mouseOut(el);
  fireEvent.mouseLeave(el);
};

describe("<FacetSection /> row ordering", () => {
  describe("given the pointer is inside the section", () => {
    /** @scenario "A facet value keeps its row position while the pointer is in the section" */
    it("keeps a toggled value in its row instead of yanking it to the pinned area", () => {
      const { container, rerender } = render(tree(new Set()));
      const section = container.firstElementChild as HTMLElement;
      expect(valueOrder(container)).toEqual(["a", "b", "c"]);

      // Pointer enters, then value "b" is toggled active (e.g. clicked).
      enterSection(section);
      rerender(tree(new Set(["b"])));

      // Frozen: "b" stays in its 2nd slot, highlighted in place — not pinned.
      expect(valueOrder(container)).toEqual(["a", "b", "c"]);
      expect(container.querySelector('[data-facet-value="b"]')).toHaveAttribute(
        "data-state",
        "include",
      );
    });
  });

  describe("when the pointer leaves the section", () => {
    /** @scenario "Active facet values reflow to the pinned area once the pointer leaves" */
    it("reflows the active value up to the pinned area", () => {
      const { container, rerender } = render(tree(new Set()));
      const section = container.firstElementChild as HTMLElement;

      enterSection(section);
      rerender(tree(new Set(["b"])));
      // Still frozen here — "b" sits at index 1.
      expect(valueOrder(container)[1]).toBe("b");

      leaveSection(section);

      // Thawed: "b" reflows up to the pinned area at the top.
      expect(valueOrder(container)[0]).toBe("b");
    });
  });

  // The search input lives inside the same hover-Box that triggers the
  // freeze, so naive freeze-on-hover would mask the typed-search narrow:
  // searchQuery → filtered → facetWindow would update live, but rendered
  // rows would still come from the frozen pre-search snapshot. The list
  // must narrow as the user types, even though the pointer is inside the
  // section (i.e. layout is otherwise frozen).
  describe("when search is active while the pointer is inside the section", () => {
    /** @scenario "Value search narrows the list live even while the layout would otherwise be frozen" */
    it("bypasses freeze and narrows rows as the user types", () => {
      const { container, getByLabelText } = render(tree(new Set()));
      const section = container.firstElementChild as HTMLElement;
      expect(valueOrder(container)).toEqual(["a", "b", "c"]);

      // Pointer is in the section (would normally freeze). Open search and type.
      enterSection(section);
      const searchToggle = getByLabelText("Search ORIGIN values");
      fireEvent.click(searchToggle);
      const input = container.querySelector(
        'input[placeholder^="Search"]',
      ) as HTMLInputElement;
      expect(input).toBeTruthy();
      fireEvent.change(input, { target: { value: "bra" } });

      // Only "Bravo" matches — the frozen snapshot should NOT win here.
      expect(valueOrder(container)).toEqual(["b"]);
    });

    /** @scenario "Empty-state hint and rendered rows agree when no values match" */
    it("renders empty-state alone when no rows match — not list+empty together", () => {
      const { container, getByLabelText, queryByText } = render(
        tree(new Set()),
      );
      const section = container.firstElementChild as HTMLElement;

      enterSection(section);
      fireEvent.click(getByLabelText("Search ORIGIN values"));
      const input = container.querySelector(
        'input[placeholder^="Search"]',
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "zzz-no-match" } });

      // No rows AND empty-state hint visible — they used to be inconsistent
      // (rows read frozen layout, hint read live count).
      expect(valueOrder(container)).toEqual([]);
      expect(queryByText(/No match/)).not.toBeNull();
    });
  });
});

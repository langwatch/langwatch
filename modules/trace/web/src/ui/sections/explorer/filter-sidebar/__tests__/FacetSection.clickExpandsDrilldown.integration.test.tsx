/**
 * @vitest-environment jsdom
 *
 * Clicking a facet row that carries a drilldown opens that drilldown as well
 * as applying the filter — see specs/traces-v2/evaluator-filter-label.feature,
 * rule "Picking a row opens its drilldown". The trailing chevron stays, but it
 * is no longer the only way in.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "lucide-react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// FacetSection calls useFacetSearch (server-side value search) at the top
// level. This suite renders it without a tRPC provider, so stub the hook out —
// server search has its own suite (FacetSection.serverSearch.integration.test.tsx).
vi.mock("../../../hooks/useFacetSearch", () => ({
  useFacetSearch: () => ({ values: [], totalDistinct: 0, isLoading: false }),
}));

import { FacetSection } from "../facet-section.tsx";
import type {
  FacetItem,
  FacetValueState,
} from "../../../../../behavior/explorer/filter-sidebar/types.ts";

const ITEMS: FacetItem[] = [
  { value: "eval-a", label: "Faithfulness", count: 12, dimmed: false },
  { value: "eval-b", label: "Answer relevancy", count: 5, dimmed: false },
];

/**
 * Stands in for the evaluator drilldown: the real one is fed from
 * `item.aggregates` and is exercised by EvaluatorDrilldown.integration.test.tsx.
 * All this suite needs is a `below` present exactly when the section considers
 * the row expanded, and a `trailing` chevron that expands without filtering.
 */
const renderInactiveRowExtras = (
  item: FacetItem,
  isExpanded: boolean,
  onToggleExpand: () => void,
) => ({
  trailing: (
    <button
      type="button"
      aria-label={`expand ${item.value}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
    />
  ),
  below: isExpanded ? <div data-testid={`drilldown-${item.value}`} /> : null,
});

/** The active row's own drilldown, rendered in the pinned block. */
const renderActiveRowExtras = (item: FacetItem) => (
  <div data-testid={`pinned-drilldown-${item.value}`} />
);

/**
 * Holds the filter state the way the real sidebar does, including the part
 * that matters here: a row click cycles neutral → include → exclude → neutral,
 * it is NOT a two-state on/off. Modelling it as on/off would let this suite
 * pass while the second click actually lands on "exclude" — an assertion that
 * the drilldown had closed would then be reading the wrong transition.
 *
 * The escape hatch mirrors reality too: the same filter can be dropped from
 * the query bar or a saved view, without the row being touched at all.
 */
const Harness = ({
  withDrilldown = true,
  onToggleSpy,
}: {
  withDrilldown?: boolean;
  onToggleSpy?: (field: string, value: string) => void;
}) => {
  const [states, setStates] = useState<ReadonlyMap<string, FacetValueState>>(
    () => new Map(),
  );
  const getValueState = useCallback(
    (value: string): FacetValueState => states.get(value) ?? "neutral",
    [states],
  );
  const onToggle = useCallback(
    (field: string, value: string) => {
      onToggleSpy?.(field, value);
      setStates((prev) => {
        const next = new Map(prev);
        const current = prev.get(value) ?? "neutral";
        if (current === "neutral") next.set(value, "include");
        else if (current === "include") next.set(value, "exclude");
        else next.delete(value);
        return next;
      });
    },
    [onToggleSpy],
  );
  return (
    <ChakraProvider value={defaultSystem}>
      {/* Stands in for the query bar: drops every filter without the sidebar
          row being involved. */}
      <button type="button" onClick={() => setStates(new Map())}>
        clear all filters
      </button>
      <FacetSection
        title="EVALUATOR"
        icon={Activity}
        field="evaluator"
        items={ITEMS}
        getValueState={getValueState}
        onToggle={onToggle}
        onExclude={vi.fn()}
        renderActiveRowExtras={
          withDrilldown ? renderActiveRowExtras : undefined
        }
        renderInactiveRowExtras={
          withDrilldown ? renderInactiveRowExtras : undefined
        }
      />
    </ChakraProvider>
  );
};

/** Sections start collapsed; open one so its value rows render. */
const openSection = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText("EVALUATOR"));
};

afterEach(() => {
  cleanup();
});

describe("<FacetSection /> click-to-expand", () => {
  describe("given an inactive row carrying a drilldown", () => {
    describe("when the user clicks the row itself", () => {
      /** @scenario "Clicking an evaluator row opens its verdict drilldown" */
      it("opens the drilldown and applies the filter on a single click", async () => {
        const user = userEvent.setup();
        const onToggleSpy = vi.fn();
        render(<Harness onToggleSpy={onToggleSpy} />);
        await openSection(user);

        expect(
          screen.queryByTestId("drilldown-eval-a"),
        ).not.toBeInTheDocument();

        await user.click(screen.getByText("Faithfulness"));

        expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();
        expect(onToggleSpy).toHaveBeenCalledWith("evaluator", "eval-a");
      });

      it("leaves the sibling rows closed", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openSection(user);

        await user.click(screen.getByText("Faithfulness"));

        expect(
          screen.queryByTestId("drilldown-eval-b"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the user clicks the trailing chevron instead of the row", () => {
      it("opens the drilldown without applying the filter", async () => {
        const user = userEvent.setup();
        const onToggleSpy = vi.fn();
        render(<Harness onToggleSpy={onToggleSpy} />);
        await openSection(user);

        await user.click(screen.getByLabelText("expand eval-a"));

        expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();
        expect(onToggleSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a row whose drilldown the user opened by clicking it", () => {
    describe("when the user clicks the row a second time", () => {
      /** @scenario "The drilldown stays open while the row is excluded" */
      it("keeps the drilldown open, because the row still carries a filter", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openSection(user);

        await user.click(screen.getByText("Faithfulness"));
        expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();

        await user.click(screen.getByText("Faithfulness"));

        expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();
      });
    });

    describe("when the row's filter is cycled all the way off", () => {
      /** @scenario "Dropping the filter closes the drilldown" */
      it("collapses the drilldown along with the filter", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openSection(user);

        // neutral → include → exclude → neutral
        await user.click(screen.getByText("Faithfulness"));
        await user.click(screen.getByText("Faithfulness"));
        expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();

        await user.click(screen.getByText("Faithfulness"));

        expect(
          screen.queryByTestId("drilldown-eval-a"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the filter is cleared from outside the sidebar", () => {
      /** @scenario "Clearing the filter elsewhere closes the drilldown" */
      it("collapses the drilldown even though the row was never clicked again", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await openSection(user);

        await user.click(screen.getByText("Faithfulness"));
        expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();

        await user.click(screen.getByText("clear all filters"));

        expect(
          screen.queryByTestId("drilldown-eval-a"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a section whose rows carry no drilldown", () => {
    describe("when the user clicks a row", () => {
      /** @scenario "A row carrying no drilldown filters exactly as before" */
      it("applies the filter and renders nothing extra", async () => {
        const user = userEvent.setup();
        const onToggleSpy = vi.fn();
        render(<Harness withDrilldown={false} onToggleSpy={onToggleSpy} />);
        await openSection(user);

        await user.click(screen.getByText("Faithfulness"));

        expect(onToggleSpy).toHaveBeenCalledWith("evaluator", "eval-a");
        expect(
          screen.queryByTestId("drilldown-eval-a"),
        ).not.toBeInTheDocument();
      });
    });
  });
});

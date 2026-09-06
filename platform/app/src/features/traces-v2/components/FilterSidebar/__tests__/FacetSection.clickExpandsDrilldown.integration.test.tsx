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

import { FacetSection } from "../FacetSection";
import type { FacetItem, FacetValueState } from "../types";

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
 * Holds the filter state the way the sidebar does, so a second click on the
 * same row is a genuine undo rather than a no-op against a frozen prop.
 */
const Harness = ({
  initiallyIncluded = [],
  withDrilldown = true,
  onToggleSpy,
}: {
  initiallyIncluded?: string[];
  withDrilldown?: boolean;
  onToggleSpy?: (field: string, value: string) => void;
}) => {
  const [included, setIncluded] = useState<ReadonlySet<string>>(
    () => new Set(initiallyIncluded),
  );
  const getValueState = useCallback(
    (value: string): FacetValueState =>
      included.has(value) ? "include" : "neutral",
    [included],
  );
  const onToggle = useCallback(
    (field: string, value: string) => {
      onToggleSpy?.(field, value);
      setIncluded((prev) => {
        const next = new Set(prev);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      });
    },
    [onToggleSpy],
  );
  return (
    <ChakraProvider value={defaultSystem}>
      <FacetSection
        title="EVALUATOR"
        icon={Activity}
        field="evaluator"
        items={ITEMS}
        getValueState={getValueState}
        onToggle={onToggle}
        onExclude={vi.fn()}
        renderActiveRowExtras={withDrilldown ? renderActiveRowExtras : undefined}
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
    /** @scenario "Clicking an evaluator row opens its verdict drilldown" */
    it("opens the drilldown and applies the filter on a single click", async () => {
      const user = userEvent.setup();
      const onToggleSpy = vi.fn();
      render(<Harness onToggleSpy={onToggleSpy} />);
      await openSection(user);

      expect(screen.queryByTestId("drilldown-eval-a")).not.toBeInTheDocument();

      await user.click(screen.getByText("Faithfulness"));

      expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();
      expect(onToggleSpy).toHaveBeenCalledWith("evaluator", "eval-a");
    });

    it("leaves the sibling rows closed", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await openSection(user);

      await user.click(screen.getByText("Faithfulness"));

      expect(screen.queryByTestId("drilldown-eval-b")).not.toBeInTheDocument();
    });
  });

  describe("given a row whose drilldown the user opened by clicking it", () => {
    /** @scenario "Clicking the same row again closes the drilldown it opened" */
    it("collapses the drilldown when the filter is dropped", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await openSection(user);

      await user.click(screen.getByText("Faithfulness"));
      expect(screen.getByTestId("drilldown-eval-a")).toBeInTheDocument();

      await user.click(screen.getByText("Faithfulness"));

      expect(screen.queryByTestId("drilldown-eval-a")).not.toBeInTheDocument();
    });
  });

  describe("given a section whose rows carry no drilldown", () => {
    /** @scenario "A row carrying no drilldown filters exactly as before" */
    it("applies the filter and renders nothing extra", async () => {
      const user = userEvent.setup();
      const onToggleSpy = vi.fn();
      render(<Harness withDrilldown={false} onToggleSpy={onToggleSpy} />);
      await openSection(user);

      await user.click(screen.getByText("Faithfulness"));

      expect(onToggleSpy).toHaveBeenCalledWith("evaluator", "eval-a");
      expect(screen.queryByTestId("drilldown-eval-a")).not.toBeInTheDocument();
    });
  });

  describe("when the trailing chevron is used instead of the row", () => {
    it("still opens the drilldown without applying the filter", async () => {
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

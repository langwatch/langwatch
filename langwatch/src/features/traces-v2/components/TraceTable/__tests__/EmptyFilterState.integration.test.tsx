/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockOnLaunchTour = vi.fn();
let mockHasAnyTraces: boolean | undefined = false;

vi.mock("../../../hooks/useProjectHasTraces", () => ({
  useProjectHasTraces: () => ({
    hasAnyTraces: mockHasAnyTraces,
    isLoading: false,
  }),
}));
vi.mock("../../../onboarding/hooks/useTourEntryPoints", () => ({
  useTourEntryPoints: () => ({ onLaunchTour: mockOnLaunchTour }),
}));

import { EmptyFilterState } from "../EmptyFilterState";
import { useFilterStore } from "../../../stores/filterStore";
import { useViewStore } from "../../../stores/viewStore";

function renderEmpty() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EmptyFilterState />
    </ChakraProvider>,
  );
}

describe("EmptyFilterState", () => {
  beforeEach(() => {
    mockOnLaunchTour.mockClear();
    mockHasAnyTraces = false;
    const now = Date.now();
    useFilterStore.setState({
      queryText: "",
      timeRange: {
        from: now - 24 * 60 * 60 * 1000,
        to: now,
        label: "Last 24 hours",
        presetId: "1d",
      },
    });
    useViewStore.setState({ activeLensId: "all-traces" });
  });
  afterEach(cleanup);

  describe("given a project that has never received a trace", () => {
    describe("when there is no active search query", () => {
      /** @scenario A never-traced project shows the empty state, not the auto-tour */
      it("shows the no-traces empty state with a Take the tour button", () => {
        const { getByText, getByRole } = renderEmpty();

        expect(getByText("No traces yet")).toBeInTheDocument();
        expect(
          getByRole("button", { name: /take the tour/i }),
        ).toBeInTheDocument();
      });

      it("launches the tour when the button is clicked", () => {
        const { getByRole } = renderEmpty();

        fireEvent.click(getByRole("button", { name: /take the tour/i }));

        expect(mockOnLaunchTour).toHaveBeenCalledTimes(1);
      });

      it("does not offer the time-window widening buttons (no data exists yet)", () => {
        const { queryByRole } = renderEmpty();

        expect(
          queryByRole("button", { name: /last 7 days/i }),
        ).not.toBeInTheDocument();
      });
    });

    describe("when a search query is active", () => {
      /** @scenario The tour button is hidden while a search query is active */
      it("explains nothing matches and hides the tour button", () => {
        useFilterStore.setState({ queryText: "model:gpt-9 nonexistent" });

        const { getByText, queryByRole } = renderEmpty();

        expect(getByText(/nothing matches these filters/i)).toBeInTheDocument();
        expect(
          queryByRole("button", { name: /take the tour/i }),
        ).not.toBeInTheDocument();
      });
    });
  });
});

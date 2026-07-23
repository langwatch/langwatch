/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { slug: "my-project" },
    hasPermission: () => true,
  }),
}));

const period = { daysDifference: 1 };
const setRelativePeriod = vi.fn();
vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({ ...period, setRelativePeriod }),
}));

vi.mock("~/components/analytics/CustomGraph", () => ({
  CustomGraph: ({
    emptyState,
    input,
  }: {
    emptyState?: React.ReactNode;
    input?: { graphType?: string };
  }) => (
    <div
      data-testid={
        input?.graphType === "line"
          ? "traces-overview-trend"
          : "traces-overview-graph"
      }
    >
      {emptyState}
    </div>
  ),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { TracesOverview } from "../TracesOverview";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<TracesOverview />", () => {
  afterEach(cleanup);

  it("renders the figures", () => {
    renderWithProviders(<TracesOverview />);

    expect(screen.getByTestId("traces-overview-graph")).toBeDefined();
  });

  it("offers useful first actions instead of a dead no-data message", () => {
    renderWithProviders(<TracesOverview />);

    expect(
      screen.getByText("Nothing here yet — pick a quick start"),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Connect tracing/ }),
    ).toHaveAttribute("href", "/my-project/traces");
    expect(
      screen.getByRole("link", { name: /Create a prompt/ }),
    ).toHaveAttribute("href", "/my-project/prompts");
    expect(
      screen.getByRole("link", { name: /Run a simulation/ }),
    ).toHaveAttribute("href", "/my-project/simulations");
  });
});

describe("<TracesOverview /> presentation", () => {
  afterEach(() => {
    cleanup();
    period.daysDifference = 1;
    setRelativePeriod.mockClear();
  });

  describe("given too few readings to draw a shape", () => {
    /** @scenario A window too short to have a trend does not draw one */
    it("draws no curve through one or two points", () => {
      for (const days of [1, 2, 3]) {
        period.daysDifference = days;
        renderWithProviders(<TracesOverview variant="trend" />);

        expect(screen.queryByTestId("traces-overview-trend")).toBeNull();
        expect(screen.queryByText(/Show the trend/)).toBeNull();
        cleanup();
      }
    });

    it("says what the figures are compared against instead", () => {
      period.daysDifference = 2;
      renderWithProviders(<TracesOverview variant="strip" />);

      expect(
        screen.getByText("Each figure is compared with the period before it."),
      ).toBeDefined();
    });

    it("offers a window wide enough to show a real trend", () => {
      period.daysDifference = 1;
      renderWithProviders(<TracesOverview variant="strip" />);

      fireEvent.click(screen.getByRole("button", { name: /See last 30 days/ }));

      expect(setRelativePeriod).toHaveBeenCalledWith("30d");
    });
  });

  describe("given a window with room for a trend", () => {
    /** @scenario Every figure says what window it covers */
    it("still says what the figures are compared against", () => {
      period.daysDifference = 7;
      renderWithProviders(<TracesOverview variant="strip" />);

      // The footer carries both halves in every case. A reader on a window
      // wide enough for a trend used to be offered the chart but never told
      // what the deltas were measured against.
      expect(
        screen.getByText("Each figure is compared with the period before it."),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: /Show the trend/ }),
      ).toBeDefined();
    });

    /** @scenario Every figure says what window it covers */
    it("names the window on the control that opens the chart", () => {
      period.daysDifference = 7;
      renderWithProviders(<TracesOverview variant="strip" />);

      expect(
        screen.getByRole("button", { name: "Show the trend over the last 7 days" }),
      ).toBeDefined();
    });

    it("keeps the chart behind the click in the strip variant", () => {
      period.daysDifference = 7;
      renderWithProviders(<TracesOverview variant="strip" />);

      expect(screen.getByTestId("traces-overview-graph")).toBeDefined();
      expect(screen.queryByTestId("traces-overview-trend")).toBeNull();
    });

    it("shows the chart without a click in the trend variant", () => {
      period.daysDifference = 7;
      renderWithProviders(<TracesOverview variant="trend" />);

      expect(screen.getByTestId("traces-overview-trend")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Show the trend/ })).toBeNull();
    });
  });

  describe("given the full variant the classic home uses", () => {
    it("adds no disclosure and no trend of its own", () => {
      period.daysDifference = 7;
      renderWithProviders(<TracesOverview variant="full" />);

      expect(screen.queryByText(/Show the trend/)).toBeNull();
      expect(screen.queryByTestId("traces-overview-trend")).toBeNull();
      expect(screen.getByTestId("traces-overview-graph")).toBeDefined();
    });
  });

  /** @scenario Every figure says what window it covers */
  it("always states the window the figures cover", () => {
    period.daysDifference = 7;
    renderWithProviders(<TracesOverview variant="strip" />);

    expect(screen.getByText("Last 7 days")).toBeDefined();
  });
});

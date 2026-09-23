/**
 * @vitest-environment jsdom
 * Traces-overview card labels figures with their window; avoids curves with
 * too few daily readings.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const period = { daysDifference: 1 };
const setRelativePeriod = vi.fn();
vi.mock("@langwatch/analytics-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePeriodSelector: () => ({ ...period, setRelativePeriod }),
}));

vi.mock("@langwatch/analytics-browser/surfaces/custom-graph", () => ({
  CustomGraph: ({
    emptyState,
    input,
  }: {
    emptyState?: React.ReactNode;
    input?: { graphType?: string; excludeOrigins?: string[] };
  }) => (
    <div
      data-testid={input?.graphType === "line" ? "traces-overview-trend" : "traces-overview-graph"}
      data-exclude-origins={(input?.excludeOrigins ?? []).join(",")}
    >
      {emptyState}
    </div>
  ),
}));

import {
  ProjectHomeHostProvider,
  ProjectHomeHost,
  type ProjectHomeProject,
} from "../../../../../model/project-home-host.ts";
import { TracesOverview } from "../traces-overview.tsx";

class StubProjectHomeHost extends ProjectHomeHost {
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "My Project", slug: "my-project" };
  }
  organization() {
    return undefined;
  }
  currentUser() {
    return undefined;
  }
  isLoading(): boolean {
    return false;
  }
  hasPermission(): boolean {
    return true;
  }
  featureFlag() {
    return { enabled: false, isLoading: false };
  }
  langyVisibility() {
    return { show: false, isResolving: false };
  }
  canAskLangy(): boolean {
    return false;
  }
  deployment() {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return false;
  }
  navigate(): void {}
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>{ui}</ProjectHomeHostProvider>
    </ChakraProvider>,
  );
}

describe("<TracesOverview /> presentation", () => {
  afterEach(() => {
    cleanup();
    period.daysDifference = 1;
    setRelativePeriod.mockClear();
  });

  /** @scenario "The home figures leave out Langy's own turns" */
  it("leaves Langy's own turns out of the figures", () => {
    renderWithProviders(<TracesOverview />);

    expect(screen.getByTestId("traces-overview-graph").getAttribute("data-exclude-origins")).toBe(
      "langy",
    );
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
  });

  describe("given a window with room for a trend", () => {
    /** @scenario Every figure says what window it covers */
    it("names the window on the control that opens the chart", () => {
      period.daysDifference = 7;
      renderWithProviders(<TracesOverview variant="strip" />);

      expect(
        screen.getByRole("button", { name: "Show the trend over the last 7 days" }),
      ).toBeDefined();
    });
  });

  /** @scenario Every figure says what window it covers */
  it("always states the window the figures cover", () => {
    period.daysDifference = 7;
    renderWithProviders(<TracesOverview variant="strip" />);

    expect(screen.getByText("Last 7 days")).toBeDefined();
  });
});

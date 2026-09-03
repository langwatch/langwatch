/**
 * @vitest-environment jsdom
 *
 * The traces-overview card labels its figures with the window they cover —
 * an unlabelled delta is noise — and never draws a curve through too few
 * daily readings to show real shape.
 *
 * Ported from platform/app/src/components/home/__tests__/TracesOverview.unit.test.tsx
 * (origin/main), adapted from the deleted `~/hooks/useOrganizationTeamProject`
 * + `~/components/PeriodSelector` + `~/components/analytics/CustomGraph` mocks
 * to `ProjectHomeHostProvider` and the `@langwatch/analytics-web` subpath
 * exports the component now imports. See specs/home/langy-home.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const period = { daysDifference: 1 };
const setRelativePeriod = vi.fn();
vi.mock("@langwatch/analytics-web/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({ ...period, setRelativePeriod }),
}));

vi.mock("@langwatch/analytics-web/components/CustomGraph", () => ({
  CustomGraph: ({
    emptyState,
    input,
  }: {
    emptyState?: React.ReactNode;
    input?: { graphType?: string };
  }) => (
    <div data-testid={input?.graphType === "line" ? "traces-overview-trend" : "traces-overview-graph"}>
      {emptyState}
    </div>
  ),
}));

import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeProject,
} from "../../../../model/project-home-host";
import { TracesOverview } from "../traces-overview";

class StubProjectHomeHost extends ProjectHomeHostPort {
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

/**
 * @vitest-environment jsdom
 *
 * The Analytics v2 page (`/[project]/analytics-v2`): nine dashboard-widget
 * cards fed by the standard `DashboardWidgetFrame`, gated by the project's
 * LangWatchQL enablement.
 *
 * `DashboardWidgetFrame` is mocked — its own contract (compile, mount,
 * query, render) is covered by `DashboardWidgetFrame.integration.test.tsx`
 * and `authorRuntime.unit.test.ts`. This suite proves the page/grid wiring
 * around it: nine cards in the right order carrying the right definitions,
 * every card re-rendering when the shared period changes (the frame reads
 * `usePeriodSelector()` itself, exactly as the real component does — so a
 * period change reaching all nine stubs is the same proof a period change
 * would give against the real frame), one crashing widget staying contained
 * to its own card, and the single clear message when LangWatchQL is off.
 *
 * @see specs/analytics/analytics-v2.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePeriodSelector } from "~/components/PeriodSelector";
import { ANALYTICS_V2_WIDGETS } from "~/features/analytics-v2/widgets";

import AnalyticsV2Page from "../index";

const state = vi.hoisted(() => ({
  period: {
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-01-02T00:00:00.000Z"),
  },
  throwForId: null as string | null,
  frameCalls: [] as { id: string; graph: unknown }[],
  lwqlEnabled: true,
  lwqlIsError: false,
  organization: { id: "org_1" } as { id: string } | undefined,
  workspaceError: undefined as unknown,
  refetch: vi.fn(),
}));

vi.mock("~/components/GraphsLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
    organization: state.organization,
    workspaceError: state.workspaceError,
  }),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({
    period: state.period,
    mode: "relative" as const,
    isDefault: true,
  }),
}));

// Page gate: LWQL_WORKBENCH_FRONTEND_FLAG via useFeatureFlag.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    enabled: state.lwqlEnabled,
    isLoading: false,
    isError: state.lwqlIsError,
    refetch: state.refetch,
  }),
}));

vi.mock("~/features/custom-chart-playground/DashboardWidgetFrame", () => ({
  DashboardWidgetFrame: (props: { id: string; graph: unknown }) => {
    state.frameCalls.push({ id: props.id, graph: props.graph });
    if (state.throwForId === props.id) {
      throw new Error(`widget ${props.id} crashed`);
    }
    const { period } = usePeriodSelector();
    return (
      <div data-testid="frame">
        {`${props.id}:${period.startDate.toISOString()}`}
      </div>
    );
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("the Analytics v2 page", () => {
  beforeEach(() => {
    state.period = {
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-02T00:00:00.000Z"),
    };
    state.throwForId = null;
    state.frameCalls = [];
    state.lwqlEnabled = true;
    state.lwqlIsError = false;
    state.organization = { id: "org_1" };
    state.workspaceError = undefined;
    state.refetch.mockClear();
  });
  afterEach(cleanup);

  describe("given a project with LangWatchQL enabled", () => {
    /** @scenario "The Analytics v2 page shows the nine charts" */
    it("shows nine widget cards, titled in contract order, each rendering its own definition", () => {
      render(<AnalyticsV2Page />, { wrapper: Wrapper });

      for (const widget of ANALYTICS_V2_WIDGETS) {
        const card = screen.getByTestId(`analytics-v2-widget-${widget.id}`);
        expect(card).toHaveTextContent(widget.title);
      }
      expect(screen.getAllByTestId("frame")).toHaveLength(9);
      expect(state.frameCalls.map((c) => c.id)).toEqual(
        ANALYTICS_V2_WIDGETS.map((w) => w.id),
      );
      for (const call of state.frameCalls) {
        const widget = ANALYTICS_V2_WIDGETS.find((w) => w.id === call.id);
        expect(call.graph).toEqual(widget?.definition);
      }
    });

    describe("when the member picks a different period", () => {
      /** @scenario "Changing the period re-queries every chart" */
      it("re-renders every one of the nine widgets with the new period", () => {
        const { rerender } = render(<AnalyticsV2Page />, { wrapper: Wrapper });

        const before = screen
          .getAllByTestId("frame")
          .map((el) => el.textContent);
        expect(before).toHaveLength(9);

        state.period = {
          startDate: new Date("2026-02-01T00:00:00.000Z"),
          endDate: new Date("2026-02-02T00:00:00.000Z"),
        };
        rerender(<AnalyticsV2Page />);

        const after = screen
          .getAllByTestId("frame")
          .map((el) => el.textContent);
        expect(after).toHaveLength(9);
        for (let i = 0; i < 9; i++) {
          expect(after[i]).not.toBe(before[i]);
          expect(after[i]).toContain("2026-02-01T00:00:00.000Z");
        }
      });
    });

    describe("when one widget throws while rendering", () => {
      /** @scenario "One failing widget does not take the other eight down" */
      it("shows a failure for that card and still renders the other eight", () => {
        state.throwForId = "top-models";
        render(<AnalyticsV2Page />, { wrapper: Wrapper });

        expect(
          screen.getByText("This chart could not be rendered."),
        ).toBeInTheDocument();
        expect(screen.getAllByTestId("frame")).toHaveLength(8);
      });
    });
  });

  describe("given a project without LangWatchQL enabled", () => {
    /** @scenario "A project without LangWatchQL sees one clear message" */
    it("shows the disabled message and renders no widget cards", () => {
      state.lwqlEnabled = false;
      render(<AnalyticsV2Page />, { wrapper: Wrapper });

      expect(
        screen.getByTestId("analytics-v2-lwql-disabled"),
      ).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-v2-widget-/)).toHaveLength(0);
    });
  });

  describe("when the organization is still resolving", () => {
    /** @scenario "The page waits while the organization is still resolving" */
    it("shows the spinner and neither the disabled message nor a widget card", () => {
      state.organization = undefined;
      render(<AnalyticsV2Page />, { wrapper: Wrapper });

      expect(screen.getByTestId("analytics-v2-loading")).toBeInTheDocument();
      expect(
        screen.queryByTestId("analytics-v2-lwql-disabled"),
      ).not.toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-v2-widget-/)).toHaveLength(0);
    });
  });

  describe("when the LangWatchQL flag check fails", () => {
    /** @scenario "A failed LangWatchQL flag check offers a retry" */
    it("shows a retryable error and clicking Try again refetches", () => {
      state.lwqlIsError = true;
      render(<AnalyticsV2Page />, { wrapper: Wrapper });

      expect(screen.getByTestId("analytics-v2-flag-error")).toBeInTheDocument();
      expect(
        screen.queryByTestId("analytics-v2-lwql-disabled"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Try again"));
      expect(state.refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the workspace read is refused", () => {
    /** @scenario "A refused workspace read shows an error with a retry, not a spinner" */
    it("renders the workspace error with a Try again control and no spinner, message or widget card", () => {
      state.workspaceError = new Error("FORBIDDEN");
      state.organization = undefined;
      render(<AnalyticsV2Page />, { wrapper: Wrapper });

      expect(
        screen.getByTestId("analytics-v2-workspace-error"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("analytics-v2-loading"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("analytics-v2-lwql-disabled"),
      ).not.toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-v2-widget-/)).toHaveLength(0);
      expect(screen.getByText("Try again")).toBeInTheDocument();
    });
  });
});

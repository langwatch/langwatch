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
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_V2_WIDGETS } from "~/features/analytics-v2/widgets";

const state = vi.hoisted(() => ({
  period: {
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-01-02T00:00:00.000Z"),
  },
  throwForId: null as string | null,
  frameCalls: [] as { id: string; graph: unknown }[],
  lwqlEnabled: true,
}));

vi.mock("~/components/GraphsLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
  }),
}));

vi.mock("~/components/PeriodSelector", () => ({
  usePeriodSelector: () => ({
    period: state.period,
    mode: "relative" as const,
    isDefault: true,
  }),
}));

// The page's own gate — grepped in the implementation contract as "the
// client LangWatchQL feature-flag hook". `~/hooks/useFeatureFlag` is the
// established pattern for a project-scoped gate elsewhere in the codebase
// (see `src/server/analytics/lwql/access.ts`'s `LWQL_FLAG`), so this mocks
// that module. If the landed page reads the flag through a different hook,
// this mock target needs updating to match — see the write-up's report.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: state.lwqlEnabled, isLoading: false }),
}));

vi.mock("~/features/custom-chart-playground/DashboardWidgetFrame", async () => {
  const { usePeriodSelector } = await import("~/components/PeriodSelector");
  return {
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
  };
});

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
  });
  afterEach(cleanup);

  describe("given a project with LangWatchQL enabled", () => {
    /** @scenario "The Analytics v2 page shows the nine charts" */
    it("shows nine widget cards, titled in contract order, each rendering its own definition", async () => {
      const { default: AnalyticsV2Page } = await import("../index");
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
      it("re-renders every one of the nine widgets with the new period", async () => {
        const { default: AnalyticsV2Page } = await import("../index");
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
      it("shows a failure for that card and still renders the other eight", async () => {
        state.throwForId = "top-models";
        const { default: AnalyticsV2Page } = await import("../index");
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
    it("shows the disabled message and renders no widget cards", async () => {
      state.lwqlEnabled = false;
      const { default: AnalyticsV2Page } = await import("../index");
      render(<AnalyticsV2Page />, { wrapper: Wrapper });

      expect(
        screen.getByTestId("analytics-v2-lwql-disabled"),
      ).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-v2-widget-/)).toHaveLength(
        0,
      );
    });
  });
});

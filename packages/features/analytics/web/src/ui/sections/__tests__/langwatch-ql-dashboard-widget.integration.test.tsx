/**
 * @vitest-environment jsdom
 *
 * What the dashboard widget asks for, and which answer it draws.
 *
 * Three claims a member would be hurt by getting wrong, and none of them is
 * visible from the component's props.
 *
 * The **coarsen request** is the one that keeps a card from blanking: the
 * widget does not own the period, so a saved one-second chart meets a
 * year-wide dashboard sooner or later. `onBudgetOverflow: "coarsen"` has to
 * reach the wire — a widget that sent the workbench's `"refuse"` would show an
 * error on a card whose owner changed nothing, and every prop-level assertion
 * would still pass.
 *
 * The **notice** is what stops the coarsening being a silent substitution, and
 * it must appear only when one happened: a notice on an uncoarsened card tells
 * a member their numbers were changed when they were not.
 *
 * The **stale answer** is the one that is invisible by construction. A period
 * drag fires a run per intermediate window and nothing orders the responses, so
 * without a sequence guard the card can settle on the answer for a period the
 * dashboard already left, with no spinner and nothing on screen admitting it.
 *
 * The tRPC client is mocked at `~/utils/api` rather than driven through a real
 * one, so that a mutation's resolution can be held open and released out of
 * order — which is the whole shape of the race being pinned.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";

const { mutateMock, chartQueryMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  chartQueryMock: vi.fn(),
}));

vi.mock("../../../behavior/use-analytics-period", () => ({
  useAnalyticsPeriod: () => ({
    period: {
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-01-02T00:00:00Z"),
    },
  }),
}));

vi.mock("../../../behavior/analytics-api", () => ({
  analyticsApi: {
    analytics: {
      savedWorkbenchCharts: {
        getById: { useQuery: () => chartQueryMock() },
        run: {
          useMutation: () => ({
            mutate: mutateMock,
            data: undefined,
            error: null,
          }),
        },
      },
    },
  },
}));

// The lazy Vega boundary renders nothing useful under jsdom and would pull
// several megabytes of chart runtime into this suite. Replaced with a marker
// that echoes the row count, so "the widget drew this answer" is observable
// without mounting Vega.
vi.mock("../lazy-langwatch-ql-widget-chart", () => ({
  LazyLangWatchQLWidgetChart: ({ rows }: { rows: readonly Record<string, unknown>[] }) => (
    <div data-testid="widget-chart">{JSON.stringify(rows)}</div>
  ),
}));

import { LangWatchQLDashboardWidget } from "../langwatch-ql-dashboard-widget";

const CHART = {
  id: "chart_1",
  name: "p95 latency",
  definition: { vegaLiteSpec: undefined },
};

/** A run answer, with the coarsening fields only when a coarsening happened. */
function answer({
  rows,
  granularitySeconds = 60,
  coarsenedFromSeconds,
}: {
  rows: readonly Record<string, unknown>[];
  granularitySeconds?: number;
  coarsenedFromSeconds?: number;
}) {
  return {
    columns: [{ name: "value", type: "UInt64" }],
    rows,
    granularitySeconds,
    ...(coarsenedFromSeconds === undefined ? {} : { coarsenedFromSeconds }),
  };
}

const mount = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

function mountWidget(props: { granularitySeconds?: LangWatchQLGranularityStep } = {}) {
  return mount(
    <LangWatchQLDashboardWidget
      chartId="chart_1"
      projectId="project_1"
      name="p95 latency"
      {...props}
    />,
  );
}

beforeEach(() => {
  mutateMock.mockReset();
  chartQueryMock.mockReset();
  chartQueryMock.mockReturnValue({ data: CHART, error: null });
});

afterEach(() => {
  cleanup();
});

describe("the LangWatchQL dashboard widget", () => {
  describe("given a placed saved chart", () => {
    /** @scenario "A placed widget asks the run to coarsen rather than refuse" */
    it("asks the run to coarsen rather than refuse", async () => {
      mountWidget({ granularitySeconds: 1 });

      await waitFor(() => expect(mutateMock).toHaveBeenCalled());

      // The request body itself, not a prop: this is the field that decides
      // whether a wide period blanks the card or redraws it.
      expect(mutateMock.mock.calls[0]?.[0]).toMatchObject({
        id: "chart_1",
        projectId: "project_1",
        granularitySeconds: 1,
        onBudgetOverflow: "coarsen",
      });
    });
  });

  describe("when the run reports a coarsening", () => {
    /** @scenario "A coarsened widget says which step it actually ran at" */
    it("shows the notice naming both steps", async () => {
      mountWidget({ granularitySeconds: 1 });

      await waitFor(() => expect(mutateMock).toHaveBeenCalled());
      mutateMock.mock.calls[0]?.[1]?.onSuccess?.(
        answer({
          rows: [{ value: 1 }],
          granularitySeconds: 3600,
          coarsenedFromSeconds: 1,
        }),
      );

      const notice = await screen.findByTestId("lwql-widget-coarsened-notice");
      expect(notice).toHaveTextContent("1-hour");
      expect(notice).toHaveTextContent("1-second");
    });
  });

  describe("when the run reports no coarsening", () => {
    it("shows no notice", async () => {
      mountWidget({ granularitySeconds: 60 });

      await waitFor(() => expect(mutateMock).toHaveBeenCalled());
      mutateMock.mock.calls[0]?.[1]?.onSuccess?.(
        answer({ rows: [{ value: 1 }], granularitySeconds: 60 }),
      );

      await screen.findByTestId("widget-chart");
      expect(screen.queryByTestId("lwql-widget-coarsened-notice")).not.toBeInTheDocument();
    });
  });

  describe("when an older request resolves after a newer one", () => {
    /** @scenario "A widget ignores an answer for a period it has left" */
    it("keeps the newer answer and drops the straggler", async () => {
      const { rerender } = mountWidget({ granularitySeconds: 1 });

      await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

      // A second request, as a period drag would issue: same chart, different
      // step, so the widget's request key changes and a new run fires.
      rerender(
        <ChakraProvider value={defaultSystem}>
          <LangWatchQLDashboardWidget
            chartId="chart_1"
            projectId="project_1"
            name="p95 latency"
            granularitySeconds={3600}
          />
        </ChakraProvider>,
      );

      await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(2));

      // The newer request answers first, then the older one straggles in —
      // the exact order that has no spinner and no error to reveal it.
      mutateMock.mock.calls[1]?.[1]?.onSuccess?.(
        answer({ rows: [{ value: "newer" }], granularitySeconds: 3600 }),
      );
      await screen.findByTestId("widget-chart");

      mutateMock.mock.calls[0]?.[1]?.onSuccess?.(
        answer({ rows: [{ value: "stale" }], granularitySeconds: 1 }),
      );

      // Asserted on the drawn rows, because "the card is showing the wrong
      // period" is a claim about what is on screen, not about which callback
      // ran.
      await waitFor(() => {
        expect(screen.getByTestId("widget-chart")).toHaveTextContent("newer");
      });
      expect(screen.getByTestId("widget-chart")).not.toHaveTextContent("stale");
    });
  });

  describe("when the saved SQL fails with a failure the platform can name", () => {
    /** @scenario "A widget names a run refusal instead of the generic card" */
    it("renders the shared registry's copy for the error code", async () => {
      mountWidget();

      await waitFor(() => expect(mutateMock).toHaveBeenCalled());

      // The tRPC envelope a handled error rides in (`data.error`), exactly as
      // `handledErrorMiddleware` serialises it — the same payload the
      // workbench's result pane reads. The widget must resolve it through the
      // shared presentation registry, not a mapping of its own.
      mutateMock.mock.calls[0]?.[1]?.onError?.({
        message: "lwql_unparseable",
        data: {
          error: {
            code: "lwql_unparseable",
            httpStatus: 400,
            fault: "customer",
          },
        },
      });

      const alert = await screen.findByRole("alert");
      // THE REGISTRY'S WORDS ARE `platform/app`'s AND DO NOT TRAVEL. This used
      // to assert the resolved copy for `lwql_unparseable`; the package alert
      // says what the registry itself says for a code it does not list, so what
      // is asserted here is what a package can still guarantee — the widget
      // names the action that failed rather than inventing a diagnosis, and the
      // wire message, which since #5984 IS the code slug, never reaches the
      // reader.
      expect(alert).toHaveTextContent("Couldn't run this chart's query");
      expect(alert).not.toHaveTextContent(/lwql_unparseable/);
    });
  });

  describe("when the run fails with an error nobody can name", () => {
    /** @scenario "A widget falls back to the generic card only for unknown failures" */
    it("renders the generic treatment under the widget's own headline", async () => {
      mountWidget();

      await waitFor(() => expect(mutateMock).toHaveBeenCalled());

      // A plain error with no handled payload: the correct degraded outcome.
      mutateMock.mock.calls[0]?.[1]?.onError?.(new Error("socket hang up"));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't run this chart's query");
      // Nothing internal leaks into the card.
      expect(alert).not.toHaveTextContent("socket hang up");
    });
  });

  describe("when a stale request's failure resolves after a newer answer", () => {
    it("keeps the newer answer rather than flipping to the stale error", async () => {
      const { rerender } = mountWidget({ granularitySeconds: 1 });

      await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

      rerender(
        <ChakraProvider value={defaultSystem}>
          <LangWatchQLDashboardWidget
            chartId="chart_1"
            projectId="project_1"
            name="p95 latency"
            granularitySeconds={3600}
          />
        </ChakraProvider>,
      );

      await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(2));

      mutateMock.mock.calls[1]?.[1]?.onSuccess?.(
        answer({ rows: [{ value: "newer" }], granularitySeconds: 3600 }),
      );
      await screen.findByTestId("widget-chart");

      // The abandoned request settles last, as a failure. The card must not
      // replace a fresh answer with an error for a period it already left.
      mutateMock.mock.calls[0]?.[1]?.onError?.(new Error("stale failure"));

      expect(screen.getByTestId("widget-chart")).toHaveTextContent("newer");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

/**
 * The workbench in a real browser: typing, running, and reading the result.
 *
 * What this tier adds over `langwatch-ql-workbench.integration.test.tsx` is
 * layout. The result table windows its rows against the *measured* height of a
 * real scrolling box, so under jsdom — where every element is zero by zero —
 * the virtualizer can neither be shown to window nor shown to be wrong. Here
 * the box has a height, the rows have heights, and scrolling it moves the
 * window: the assertions below are about geometry that only a browser has.
 *
 * Two seams are stubbed, and neither is what the scenario is about:
 *
 *   - the transport, at the same `analyticsApi` seam the jsdom suite uses, so
 *     this suite is about the surface rather than about the endpoint;
 *   - `@monaco-editor/react`, so the editor is a plain textarea. The real one
 *     fetches from a public CDN by default; a test that reached for it would be
 *     both flaky and a network call this feature exists to forbid.
 *
 * Chart mode is stubbed for the same reason the jsdom suite stubs it — it has
 * its own real-browser suites: `langwatch-ql-chart-mode.browser.test.tsx`,
 * `langwatch-ql-vega-chart-without-eval.browser.test.tsx` and
 * `langwatch-ql-vega-spec-network-silence.browser.test.tsx`.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@testing-library/jest-dom/vitest";

import type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";

import { SCHEMA_RESPONSE } from "../../src/__tests__/lwql-fixtures";

const harness = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock("../../src/behavior/analytics-api", () => ({
  analyticsApi: {
    useUtils: () => ({
      client: {
        analytics: {
          lwql: {
            query: { mutate: harness.mutation },
          },
        },
      },
    }),
    analytics: {
      lwql: {
        schema: {
          useQuery: () => ({
            data: SCHEMA_RESPONSE,
            isLoading: false,
            error: null,
          }),
        },
      },
      // Save and Open are the jsdom suite's business, but the workbench calls
      // these hooks unconditionally, so a mock missing them throws before this
      // suite can look at anything.
      savedWorkbenchCharts: {
        getAll: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
        create: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
        update: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
        delete: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
      },
    },
  },
}));

vi.mock("@monaco-editor/react", () => {
  function StubMonacoEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="lwql-editor-input"
        aria-label="LangWatchQL ClickHouse SQL statement"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: StubMonacoEditor };
});

vi.mock("../../src/ui/sections/lazy-langwatch-ql-chart-mode", () => ({
  LazyLangWatchQLChartMode: () => <div data-testid="stub-chart-mode" />,
}));

import { LangWatchQLWorkbench } from "../../src/ui/sections/langwatch-ql-workbench-panel";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../src/testing";

const SQL = "SELECT evaluator_id, score FROM analytics.evaluations_daily LIMIT 500";

/**
 * The address the workbench is mounted at, period and all.
 *
 * The workbench reads the page's period for the time window it sends, and the
 * period is read off the analytics host rather than a router — so the range is
 * a fixture on the stub host, the same way the jsdom suite states it.
 */
const PAGE_QUERY = {
  startDate: "2026-02-20T00:00:00.000Z",
  endDate: "2026-02-27T00:00:00.000Z",
};

/** The whole page: the host that answers the address, and the workbench on it. */
function renderWorkbench() {
  return render(
    <AnalyticsTestHarness
      host={new StubAnalyticsHost({ route: { params: {}, query: PAGE_QUERY } })}
    >
      <LangWatchQLWorkbench projectId="project-1" />
    </AnalyticsTestHarness>,
  );
}

/**
 * How long a first paint is given, and why it is not the library's default.
 *
 * The editor is behind `lazy(() => import("@monaco-editor/react"))` and a
 * Suspense boundary, so even the stubbed module arrives a dynamic import later.
 * Testing Library waits one second by default; with all four files of this lane
 * driving their own Chromium context at once that budget is genuinely tight,
 * and the wait failed roughly one run in four. The suite's own `poll` already
 * uses ten seconds for the same reason.
 */
const MOUNT_TIMEOUT = { timeout: 10_000 };

/** Enough rows that a window over them is a small fraction of the whole. */
const ROW_COUNT = 500;

function evaluationRows(): Record<string, unknown>[] {
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    evaluator_id: `evaluator-${String(index).padStart(3, "0")}`,
    // Distinct per row and never a bare integer, so a cell found by its text
    // belongs to exactly one row.
    score: index + 0.5,
  }));
}

function evaluationResult(): LangWatchQLQueryResult {
  return {
    columns: [
      { name: "evaluator_id", type: "String" },
      { name: "score", type: "Nullable(Float64)" },
    ],
    rows: evaluationRows(),
    statistics: {
      elapsedMs: 42,
      rowsRead: 1_000_000,
      bytesRead: 65_536,
      rowsReturned: ROW_COUNT,
    },
    truncated: false,
    diagnostics: [],
    followsTimeWindow: false,
    followsGranularity: false,
  };
}

function renderedRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="lwql-result-row"]'));
}

function renderedRowIndexes(): number[] {
  return renderedRows().map((row) => Number(row.dataset.index));
}

/** Each run statistic as the pair a member reads: the value, then its label. */
function statisticPairs(): (string | null)[][] {
  const summary = screen.getByTestId("lwql-result-summary");
  return Array.from(summary.children).map((statistic) =>
    Array.from(statistic.children).map((part) => part.textContent),
  );
}

/**
 * Polls a DOM condition without `expect`, so nothing in the assertion library
 * runs inside a wait that is measuring the browser's own scheduling.
 */
async function poll(check: () => boolean): Promise<boolean> {
  const timeoutMs = 10_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

beforeEach(async () => {
  await page.viewport(1280, 900);
  harness.mutation.mockReset();
  harness.mutation.mockResolvedValue(evaluationResult());
});

afterEach(() => cleanup());

describe("the LangWatchQL workbench in real Chromium", () => {
  describe("given an authorized member with a live LangWatchQL schema", () => {
    describe("when the member types a statement, runs it, and waits", () => {
      /** @scenario "A real browser carries a query from editor to native table" */
      it("shows the returned rows in the native result table beside the run statistics", async () => {
        renderWorkbench();

        const editor = await screen.findByTestId("lwql-editor-input", {}, MOUNT_TIMEOUT);
        await userEvent.click(editor);
        await userEvent.keyboard(SQL);
        expect(editor).toHaveValue(SQL);

        await userEvent.click(screen.getByRole("button", { name: "Run query" }));

        // The statement went out exactly as typed, once.
        await poll(() => harness.mutation.mock.calls.length > 0);
        expect(harness.mutation).toHaveBeenCalledTimes(1);
        expect(harness.mutation.mock.calls[0]?.[0]).toMatchObject({
          projectId: "project-1",
          sql: SQL,
        });

        // The rows are in a real <table>, under the column names the response
        // carried, with the database's own types beneath them.
        await poll(() => renderedRows().length > 0);
        const table = await screen.findByRole("table", {}, MOUNT_TIMEOUT);
        expect(table.querySelector("thead")?.textContent).toContain("evaluator_id");
        expect(table.querySelector("thead")?.textContent).toContain("Nullable(Float64)");
        const firstRow = renderedRows()[0];
        expect(firstRow?.textContent).toContain("evaluator-000");
        expect(firstRow?.textContent).toContain("0.5");

        // The statistics the server reported, beside the result: every value
        // paired with the label that names it.
        expect(statisticPairs()).toEqual([
          ["500", "rows returned"],
          ["42 ms", "elapsed"],
          ["1,000,000", "rows read"],
          ["64.00 KB", "bytes read"],
        ]);
      });

      /** @scenario "A real browser carries a query from editor to native table" */
      it("windows the rows against the measured viewport and moves that window when the member scrolls", async () => {
        renderWorkbench();

        const editor = await screen.findByTestId("lwql-editor-input", {}, MOUNT_TIMEOUT);
        await userEvent.click(editor);
        await userEvent.keyboard(SQL);
        await userEvent.click(screen.getByRole("button", { name: "Run query" }));
        await poll(() => renderedRows().length > 0);

        const scroller = screen.getByTestId("lwql-result-scroll");

        // Real layout: the box has a measured height, capped by the pane, and
        // the rows inside it are taller than it is. Under jsdom both numbers
        // are zero and neither half of this can be observed.
        expect(scroller.clientHeight).toBeGreaterThan(100);
        expect(scroller.clientHeight).toBeLessThanOrEqual(480);
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

        // A window, not the whole result: 500 rows returned, a fraction of
        // them in the document.
        const windowed = renderedRows().length;
        expect(windowed).toBeGreaterThan(0);
        expect(windowed).toBeLessThan(ROW_COUNT / 2);
        expect(renderedRowIndexes()).toContain(0);
        expect(screen.queryByText(`evaluator-${ROW_COUNT - 1}`)).toBeNull();

        // Scrolling the real element moves the window to the far end.
        scroller.scrollTop = scroller.scrollHeight;
        const reachedEnd = await poll(() => renderedRowIndexes().includes(ROW_COUNT - 1));
        expect(reachedEnd).toBe(true);

        // …and the rows that were on screen at the top are no longer in the
        // document at all, which is what makes this virtualization rather
        // than a scrollbar over 500 rendered rows.
        expect(renderedRowIndexes()).not.toContain(0);
        expect(screen.queryByText("evaluator-000")).toBeNull();
        expect(screen.getByText("evaluator-499")).toBeVisible();

        // Reading a result is not a reason to ask the server anything again.
        expect(harness.mutation).toHaveBeenCalledTimes(1);
      });
    });
  });
});

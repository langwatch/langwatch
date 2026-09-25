/**
 * Chart mode drawing a categorical result in a real browser: the whole
 * Vega runtime is real here, unlike the jsdom suite which stubs `vega-embed`
 * at the boundary. Only `@monaco-editor/react` is stubbed, to avoid a CDN fetch.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

vi.mock("@monaco-editor/react", () => {
  function StubSpecEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="spec-editor-input"
        aria-label="Chart specification"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: StubSpecEditor };
});

import type { LangWatchQLDatasetColumn } from "@langwatch/analytics-contract/visualization";

import { ThemedLangWatchQLChartMode } from "../../src/ui/sections/themed-langwatch-ql-chart-mode.tsx";

const COLUMNS: readonly LangWatchQLDatasetColumn[] = [
  { name: "evaluator_name", type: "String" },
  { name: "evaluations", type: "UInt64" },
];

/** A categorical result: one row per evaluator, with a count beside it. */
const RESULT = {
  columns: COLUMNS,
  rows: [
    { evaluator_name: "exact match", evaluations: 12 },
    { evaluator_name: "factual correctness", evaluations: 7 },
    { evaluator_name: "personally identifiable information", evaluations: 21 },
    { evaluator_name: "answer relevancy", evaluations: 3 },
  ],
};

/**
 * The specification a member writes over the result: a bar chart that names
 * the registered dataset and carries no data of its own.
 */
const BAR_SPECIFICATION = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { name: "query_result" },
  mark: "bar",
  encoding: {
    x: { field: "evaluator_name", type: "nominal" },
    y: { field: "evaluations", type: "quantitative" },
  },
};

/**
 * The owner's half of the specification state, which in the product is the
 * workbench. Chart mode never holds the text itself — a refused query unmounts
 * it — so anything exercising an edit has to supply the half that does.
 */
function ChartModeHost({ view }: { view: "chart" | "specification" }) {
  const [editedSpecText, setEditedSpecText] = useState<string | null>(null);

  return (
    <ThemedLangWatchQLChartMode
      result={RESULT}
      submittedLabel="SELECT evaluator_name, count() AS evaluations"
      view={view}
      editedSpecText={editedSpecText}
      onEditedSpecTextChange={setEditedSpecText}
    />
  );
}

function chartView(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="lwql-vega-chart-view"]');
}

/** The drawn bars: one SVG path per row, inside Vega's rect mark group. */
function bars(): SVGGraphicsElement[] {
  return Array.from(
    document.querySelectorAll<SVGGraphicsElement>(
      '[data-testid="lwql-vega-chart-view"] svg g.mark-rect path',
    ),
  );
}

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => cleanup());

describe("LangWatchQL chart mode in real Chromium", () => {
  describe("given a successful categorical LangWatchQL result", () => {
    describe("when the member provides a valid bar specification over the query result dataset", () => {
      /** @scenario "Chart mode preserves data and offers an accessible table fallback" */
      it("draws one bar per category from the registered dataset, sized by its value", async () => {
        const { rerender } = render(
          <ChakraProvider value={defaultSystem}>
            <ChartModeHost view="specification" />
          </ChakraProvider>,
        );

        // The member writes a bar spec over the starting point, then returns
        // to the chart (same instance, so the edit survives). The editor is
        // lazy + Suspense, so the stub arrives later than the 1s default wait.
        const editor = await screen.findByTestId("spec-editor-input", {}, { timeout: 10_000 });
        await userEvent.fill(editor, JSON.stringify(BAR_SPECIFICATION));
        rerender(
          <ChakraProvider value={defaultSystem}>
            <ChartModeHost view="chart" />
          </ChakraProvider>,
        );

        await expect.poll(() => bars().length, { timeout: 15_000 }).toBe(RESULT.rows.length);
        expect(screen.queryByTestId("lwql-chart-failure")).toBeNull();
        expect(screen.queryByTestId("vega-spec-editor-problems")).toBeNull();

        // A real SVG that reached the ready state. Vega draws the bars before
        // the host flips its status, so reading the attribute the instant the
        // bars arrive catches it still `embedding` — poll it as the bars are.
        expect(chartView()?.querySelector("svg")).not.toBeNull();
        await expect
          .poll(() => chartView()?.getAttribute("data-chart-status"), { timeout: 15_000 })
          .toBe("ready");

        // The accessible name survives a REAL embed: Vega writes its own
        // `role`/`aria-label` onto the embedded element, so the name must
        // live on a wrapper Vega never touches — invisible to the jsdom suite.
        expect(chartView()).toHaveAttribute("role", "img");
        expect(chartView()?.getAttribute("aria-label")).toContain("Chart of the result of SELECT");
        expect(chartView()?.getAttribute("aria-label")).not.toContain("Vega visualization");

        // The categories are on the axis, spelled as the result spelled them —
        // in the drawn tick labels and in the axis's own accessible name.
        const axisText = Array.from(
          document.querySelectorAll('[data-testid="lwql-vega-chart-view"] svg g.mark-text text'),
        ).map((label) => label.textContent);
        const categoryAxis = document.querySelector('[aria-roledescription="axis"]');
        expect(categoryAxis).not.toBeNull();
        const categoryAxisName = categoryAxis?.getAttribute("aria-label") ?? "";
        for (const row of RESULT.rows) {
          expect(axisText).toContain(row.evaluator_name);
          expect(categoryAxisName).toContain(row.evaluator_name);
        }

        // Real geometry, which is the whole reason this runs in a browser: the
        // bars have height, and the tallest is the row with the largest count.
        const heights = bars().map((bar) => bar.getBoundingClientRect().height);
        expect(heights.every((height) => height > 0)).toBe(true);
        const counts = RESULT.rows.map((row) => row.evaluations);
        const tallest = heights.indexOf(Math.max(...heights));
        const largest = counts.indexOf(Math.max(...counts));
        expect(tallest).toBe(largest);
        const shortest = heights.indexOf(Math.min(...heights));
        const smallest = counts.indexOf(Math.min(...counts));
        expect(shortest).toBe(smallest);

        // The specification named the dataset and carried no rows of its own,
        // so every bar above came from the registered result.
        expect(BAR_SPECIFICATION.data).toEqual({ name: "query_result" });
      });
    });
  });
});

/**
 * Chart mode drawing a categorical result in a real browser.
 *
 * `GovernedSqlChartMode.integration.test.tsx` replaces `vega-embed` at the
 * module boundary, so it can prove what the surface *asks* Vega for and
 * nothing about what Vega does with it. Here the whole runtime is real: a
 * result goes in, a validated specification is compiled by Vega-Lite, embedded
 * by Vega, and drawn as SVG — and the assertions are about the marks that come
 * out and the geometry they have.
 *
 * Only `next-dynamic` is stubbed, so the specification editor is a plain
 * textarea. The real one is Monaco, which `@monaco-editor/react` fetches from a
 * public CDN by default; a chart test that reached for it would be flaky and
 * would make a network call on a surface whose whole point is that it makes
 * none.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@testing-library/jest-dom/vitest";

vi.mock("~/utils/compat/next-dynamic", () => {
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

  return { __esModule: true, default: () => StubSpecEditor };
});

import { GovernedSqlChartMode } from "../components/GovernedSqlChartMode";
import type { GovernedDatasetColumn } from "../visualization/visualization.types";

const COLUMNS: readonly GovernedDatasetColumn[] = [
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

function chartView(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-testid="governed-vega-chart-view"]',
  );
}

/** The drawn bars: one SVG path per row, inside Vega's rect mark group. */
function bars(): SVGGraphicsElement[] {
  return Array.from(
    document.querySelectorAll<SVGGraphicsElement>(
      '[data-testid="governed-vega-chart-view"] svg g.mark-rect path',
    ),
  );
}

async function poll(
  check: () => boolean,
  timeoutMs = 15_000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => cleanup());

describe("governed chart mode in real Chromium", () => {
  describe("given a successful categorical governed SQL result", () => {
    describe("when the member provides a valid bar specification over the query result dataset", () => {
      /** @scenario "A categorical governed result renders as a chart in a real browser" */
      it("draws one bar per category from the registered dataset, sized by its value", async () => {
        const { rerender } = render(
          <ChakraProvider value={defaultSystem}>
            <GovernedSqlChartMode
              result={RESULT}
              submittedLabel="SELECT evaluator_name, count() AS evaluations"
              view="specification"
            />
          </ChakraProvider>,
        );

        // The member writes their own bar specification over the starting
        // point in the Specification view, then returns to the chart — the
        // same component instance, so the edit survives the switch.
        const editor = await screen.findByTestId("spec-editor-input");
        await userEvent.fill(editor, JSON.stringify(BAR_SPECIFICATION));
        rerender(
          <ChakraProvider value={defaultSystem}>
            <GovernedSqlChartMode
              result={RESULT}
              submittedLabel="SELECT evaluator_name, count() AS evaluations"
              view="chart"
            />
          </ChakraProvider>,
        );

        const drawn = await poll(() => bars().length === RESULT.rows.length);
        expect(screen.queryByTestId("governed-chart-failure")).toBeNull();
        expect(screen.queryByTestId("vega-spec-editor-problems")).toBeNull();
        expect(drawn).toBe(true);

        // A real SVG that reached the ready state.
        expect(chartView()?.querySelector("svg")).not.toBeNull();
        expect(chartView()).toHaveAttribute("data-chart-status", "ready");

        // The accessible name survives a REAL embed. Vega writes its own
        // `role="graphics-document"` / `aria-label="Vega visualization"` onto
        // the element it embeds into, so the component keeps its name on a
        // wrapper Vega never touches — this assertion was impossible while the
        // name sat on the mount point itself, and the jsdom suite could not
        // see the difference because it stubs `vega-embed`.
        expect(chartView()).toHaveAttribute("role", "img");
        expect(chartView()?.getAttribute("aria-label")).toContain(
          "Chart of the result of SELECT",
        );
        expect(chartView()?.getAttribute("aria-label")).not.toContain(
          "Vega visualization",
        );

        // The categories are on the axis, spelled as the result spelled them —
        // in the drawn tick labels and in the axis's own accessible name.
        const axisText = Array.from(
          document.querySelectorAll(
            '[data-testid="governed-vega-chart-view"] svg g.mark-text text',
          ),
        ).map((label) => label.textContent);
        const categoryAxisName = document
          .querySelector('[aria-roledescription="axis"]')
          ?.getAttribute("aria-label");
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

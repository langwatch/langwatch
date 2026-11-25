/**
 * What a chart card draws for small counts, partial costs and change markers: whole-number
 * ticks on a count axis, cost words that never read "$0.00+", and marker names on hover only.
 * @see modules/dashboard/specs/dashboards-v2.feature AC214, AC215, AC215b, AC215d, AC216
 */

import { describe, expect, it } from "vitest";

import { isLowerBound } from "../../../../model/dashboard-widget/chartsLib/index.ts";
import { IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../../catalogue/index.ts";
import { BOARD_TEMPLATES } from "../index.ts";
import {
  COMPLETENESS,
  MARK_HOVER,
  NUMBERS,
  SERIES_CHART,
  SPENT_HINT,
} from "../model/widget-code-parts.ts";

interface CostParts {
  sum: number | null;
  priced: boolean;
  unpriced: boolean;
}

// The stored snippets are what the frame runs; evaluating them is the test.
// oxlint-disable-next-line no-implied-eval
const cost = new Function(
  "isLowerBound",
  `${NUMBERS}\n${COMPLETENESS}\n${SPENT_HINT}\nreturn { costText, costFigure, spentHint };`,
)(isLowerBound) as {
  costText: (parts: CostParts) => string;
  costFigure: (query: { completeness: unknown }, sum: number | null) => string;
  spentHint: (query: { completeness: unknown }, sum: number | null) => string;
};

const built = [
  ...IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []),
  ...BOARD_TEMPLATES.flatMap((template) => template.widgets),
];
const code = (id: string) => implementedWidget(id)?.definition.code ?? "";

const report = ({ total, unpriced }: { total: number; unpriced: number }) => ({
  state: unpriced === total ? "missing" : "partial",
  unit: "traces",
  total,
  fields: [{ field: "TotalCost", label: "total cost", present: total - unpriced }],
  unpriced: { count: unpriced, models: ["my-finetune-v2"] },
});

describe("given a count chart", () => {
  /** @scenario "AC214 Count axis whole numbers" */
  it("asks for whole-number ticks on a count axis and keeps decimals for other formats", () => {
    expect(SERIES_CHART).toContain("allowDecimals={format !== count}");
    expect(code("up-errors")).toContain("allowDecimals={barsFormat !== count}");
    expect(code("cost-by-source")).toContain("allowDecimals={format !== count}");
  });

  /** @scenario "AC214 Count axis whole numbers" */
  it("draws no count axis of any built widget that allows decimals", () => {
    for (const { key, definition } of built) {
      for (const axis of definition.code.match(/<YAxis[^>]*tickFormatter=\{count\}[^>]*>/g) ?? []) {
        expect(axis, key).toContain("allowDecimals={false}");
      }
    }
  });
});

describe("given a cost card", () => {
  /** @scenario "AC215 Partial cost: no span priced" */
  it('shows "Not priced" when no span has a cost', () => {
    expect(cost.costText({ sum: 0, priced: false, unpriced: true })).toBe("Not priced");
  });

  it('keeps "Not priced" on costFigure when no span is priced', () => {
    expect(cost.costFigure({ completeness: report({ total: 3, unpriced: 3 }) }, 0)).toBe(
      "Not priced",
    );
  });

  /** @scenario "AC215b Partial cost: some spans priced at zero" */
  it('shows "$0.00, some requests not priced" when the priced spans sum to 0', () => {
    expect(cost.costText({ sum: 0, priced: true, unpriced: true })).toBe(
      "$0.00, some requests not priced",
    );
    expect(cost.costFigure({ completeness: report({ total: 3, unpriced: 1 }) }, 0)).toBe(
      "$0.00, some requests not priced",
    );
  });

  /** @scenario "AC215d Partial cost: a sum above 0 with some requests not priced" */
  it('marks a sum above 0 "+" when some spans have no cost', () => {
    expect(cost.costText({ sum: 12.5, priced: true, unpriced: true })).toBe("$12.50+");
  });

  /** @scenario "AC215d Partial cost: a sum above 0 with some requests not priced" */
  it("keeps today's figure for a fully priced sum, and never reads $0.00+", () => {
    expect(cost.costText({ sum: 12.5, priced: true, unpriced: false })).toBe("$12.50");
    expect(cost.costText({ sum: 0, priced: true, unpriced: false })).toBe("$0.00");
    expect(cost.costFigure({ completeness: null }, 0)).toBe("$0.00");
    for (const sum of [0, null]) {
      for (const priced of [true, false]) {
        expect(cost.costText({ sum, priced, unpriced: true })).not.toBe("$0.00+");
      }
    }
  });
});

describe("given the AI cost per resolved figure while nothing is resolved", () => {
  it("says only that nothing is resolved when no span has a cost", () => {
    expect(cost.spentHint({ completeness: report({ total: 3, unpriced: 3 }) }, 0)).toBe(
      "Nothing resolved yet",
    );
  });

  /** @scenario "AC215b Partial cost: some spans priced at zero" */
  it("names the unpriced spans when the priced ones sum to 0", () => {
    expect(cost.spentHint({ completeness: report({ total: 3, unpriced: 1 }) }, 0)).toBe(
      "$0.00 spent, some requests not priced",
    );
  });

  /** @scenario "AC215d Partial cost: a sum above 0 with some requests not priced" */
  it("keeps today's figure, + included, for a sum above 0", () => {
    expect(cost.spentHint({ completeness: report({ total: 3, unpriced: 1 }) }, 12.5)).toBe(
      "$12.50+ spent, no conversation resolved yet",
    );
    expect(cost.spentHint({ completeness: null }, 12.5)).toBe(
      "$12.50 spent, no conversation resolved yet",
    );
    expect(code("ck-kpis")).toContain("<Hint>{spentHint(spend, num(s.cost))}</Hint>");
  });
});

describe("given a widget that marks changes on its time axis", () => {
  const marked = built.filter(({ definition }) => definition.code.includes("<ReferenceLine"));

  /** @scenario "AC216 Change markers" */
  it("draws no marker text on the plot and names each change on hover", () => {
    expect(MARK_HOVER).toContain("<title>{name}</title>");
    expect(MARK_HOVER).toContain('tabIndex={0} role="img" aria-label={name}');
    expect(MARK_HOVER).toContain(".lw-mark:focus-visible");
    expect(marked.map(({ key }) => key)).toEqual(
      expect.arrayContaining(["up-errors", "tools-wrong-tool"]),
    );
    for (const { key, definition } of marked) {
      expect(definition.code, key).toContain("<title>{name}</title>");
      for (const line of definition.code.match(/<ReferenceLine[^>]*>/g) ?? []) {
        expect(line, key).toMatch(/label=\{markHover\((mark|marker)\.label\)\}/);
      }
    }
  });
});

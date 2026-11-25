/**
 * The axes of a starter chart, measured in a real browser under the design system's page styles:
 * jsdom lays nothing out, so only here can one label be seen to sit on another.
 * @see specs/lwql/workbench.feature
 */

import {
  type LangWatchQLDatasetColumn,
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
  LWQL_QUERY_RESULT_DATASET,
  starterVegaLiteSpec,
} from "@langwatch/analytics-contract/visualization";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { LangWatchQLVegaLiteChart } from "../langwatch-ql-vega-lite-chart.tsx";

// What `useLangwatchVegaTokens` resolves, as literals: no theme colour variables are set here.
const TOKENS = {
  fontFamily: "Inter, sans-serif",
  labelFontSize: 11,
  titleFontSize: 12,
  textColor: "#1d293d",
  mutedTextColor: "#62748e",
  gridColor: "#e2e8f0",
  domainColor: "#cad5e2",
  categoricalRange: ["#ed8936"],
};

const COLUMNS: readonly LangWatchQLDatasetColumn[] = [
  { name: "Model", type: "String" },
  { name: "cost", type: "Float64" },
];

const ROWS = [
  { Model: "custom/openai/gpt-5-mini", cost: 0.065 },
  { Model: "custom/openai/gpt-5.2", cost: 0.0004 },
  { Model: "gpt-5", cost: 0.044 },
  { Model: "gpt-5-mini", cost: 0.097 },
];

type Bounds = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function axis(name: "X" | "Y") {
  const group = document.querySelector(`g.role-axis[aria-label^="${name}-axis"]`);
  const bounds = (selector: string) =>
    Array.from(group?.querySelectorAll(selector) ?? []).map((el) => el.getBoundingClientRect());
  return { labels: bounds(".role-axis-label text"), titles: bounds(".role-axis-title text") };
}

async function drawn(): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (document.querySelectorAll("g.mark-rect path").length === ROWS.length) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

beforeEach(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => cleanup());

describe("a chart drawn from the starter specification", () => {
  describe("given long category names on a card as narrow as an insight's evidence", () => {
    /** @scenario "A chart's axis labels draw at the size the chart laid them out" */
    it("keeps every axis label off the axis titles and inside the chart", async () => {
      renderWithDesignSystem(
        <div style={{ width: "622px" }}>
          <LangWatchQLVegaLiteChart
            spec={starterVegaLiteSpec({ columns: COLUMNS, datasetName: LWQL_QUERY_RESULT_DATASET })}
            datasets={{ [LWQL_QUERY_RESULT_DATASET]: ROWS }}
            columnsByDataset={{ [LWQL_QUERY_RESULT_DATASET]: COLUMNS }}
            themeConfig={langwatchVegaConfig({ colorMode: "light", tokens: TOKENS })}
            pinnedConfig={langwatchVegaPinnedConfig({ tokens: TOKENS })}
            colorMode="light"
            ariaLabel="Cost by model"
          />
        </div>,
      );
      expect(await drawn()).toBe(true);

      const chart = document.querySelector("[data-testid=lwql-vega-chart-view] svg");
      const bounds = chart!.getBoundingClientRect();
      const x = axis("X");
      const y = axis("Y");
      const labels = [...x.labels, ...y.labels];
      const titles = [...x.titles, ...y.titles];

      expect(x.labels).toHaveLength(ROWS.length);
      expect(titles).toHaveLength(2);
      for (const title of titles) {
        expect(labels.filter((label) => overlaps(title, label))).toEqual([]);
      }
      for (const label of labels) {
        expect(label.left).toBeGreaterThanOrEqual(bounds.left);
        expect(label.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
    });
  });
});

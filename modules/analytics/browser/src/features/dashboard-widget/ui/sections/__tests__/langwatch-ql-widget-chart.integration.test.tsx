/**
 * @vitest-environment jsdom
 * Which specification a dashboard widget draws: its saved one, or a starter
 * built over the columns its run returned.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import {
  type LangWatchQLDatasetColumn,
  LWQL_QUERY_RESULT_DATASET,
  starterVegaLiteSpec,
} from "@langwatch/analytics-contract/visualization";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Vega renders nothing useful under jsdom; the marker echoes the spec it was handed.
vi.mock("../themed-langwatch-ql-vega-lite-chart.tsx", () => ({
  ThemedLangWatchQLVegaLiteChart: ({ spec }: { spec: Record<string, unknown> }) => (
    <div data-testid="drawn-spec">{JSON.stringify(spec)}</div>
  ),
}));

import { LangWatchQLWidgetChart } from "../langwatch-ql-widget-chart.tsx";

const BY_MODEL: readonly LangWatchQLDatasetColumn[] = [
  { name: "model", type: "String" },
  { name: "total", type: "UInt64" },
];
const OVER_TIME: readonly LangWatchQLDatasetColumn[] = [
  { name: "bucket", type: "DateTime" },
  { name: "series", type: "LowCardinality(String)" },
  { name: "latency", type: "Float64" },
];
const SAVED_SPEC = { mark: "bar", data: { name: LWQL_QUERY_RESULT_DATASET } };

function drawnSpec(): unknown {
  return JSON.parse(screen.getByTestId("drawn-spec").textContent ?? "null");
}

function starterFor(columns: readonly LangWatchQLDatasetColumn[]): unknown {
  return JSON.parse(
    JSON.stringify(starterVegaLiteSpec({ columns, datasetName: LWQL_QUERY_RESULT_DATASET })),
  );
}

afterEach(cleanup);

describe("the dashboard widget's chart", () => {
  describe("given a widget whose chart was saved without a specification", () => {
    describe("when its run returns different result columns", () => {
      /** @scenario Starter specifications follow new data until the member edits them */
      it("reshapes the starter it draws to those columns", () => {
        const { rerender } = renderWithDesignSystem(
          <LangWatchQLWidgetChart columns={BY_MODEL} rows={[]} ariaLabel="chart" />,
        );
        expect(drawnSpec()).toEqual(starterFor(BY_MODEL));

        rerender(<LangWatchQLWidgetChart columns={OVER_TIME} rows={[]} ariaLabel="chart" />);

        expect(drawnSpec()).toEqual(starterFor(OVER_TIME));
        expect(drawnSpec()).not.toEqual(starterFor(BY_MODEL));
      });
    });
  });

  describe("given a widget saved with its own specification", () => {
    describe("when its run returns different result columns", () => {
      /** @scenario Starter specifications follow new data until the member edits them */
      it("keeps drawing the saved specification", () => {
        const { rerender } = renderWithDesignSystem(
          <LangWatchQLWidgetChart
            columns={BY_MODEL}
            rows={[]}
            vegaLiteSpec={SAVED_SPEC}
            ariaLabel="chart"
          />,
        );

        rerender(
          <LangWatchQLWidgetChart
            columns={OVER_TIME}
            rows={[]}
            vegaLiteSpec={SAVED_SPEC}
            ariaLabel="chart"
          />,
        );

        expect(drawnSpec()).toEqual(SAVED_SPEC);
      });
    });
  });
});

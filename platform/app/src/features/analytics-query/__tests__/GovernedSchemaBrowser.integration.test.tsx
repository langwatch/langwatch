/**
 * @vitest-environment jsdom
 *
 * The schema browser shows what the response carried, documents it, refuses to
 * offer a withheld column, and narrows on a search.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GovernedSchemaBrowser } from "../components/GovernedSchemaBrowser";
import { governedSchemaModel } from "../logic/governedSchemaModel";

import { SCHEMA_DATASET_NAMES, SCHEMA_RESPONSE } from "./governedSqlFixtures";

function renderBrowser(onInsert = vi.fn()) {
  const model = governedSchemaModel(SCHEMA_RESPONSE);
  render(
    <ChakraProvider value={defaultSystem}>
      <GovernedSchemaBrowser
        model={model}
        isLoading={false}
        error={null}
        onInsert={onInsert}
      />
    </ChakraProvider>,
  );
  return { onInsert };
}

/**
 * The dataset toggle's accessible name is its visible row — the mono dataset
 * name plus the column count beside it — so it is matched by prefix.
 */
function datasetToggle(datasetName: string) {
  return screen.getByRole("button", {
    name: new RegExp(`^${datasetName.replace(/\./g, "\\.")}`),
  });
}

function queryDatasetToggle(datasetName: string) {
  return screen.queryByRole("button", {
    name: new RegExp(`^${datasetName.replace(/\./g, "\\.")}`),
  });
}

function expand(datasetName: string) {
  fireEvent.click(datasetToggle(datasetName));
}

describe("the governed schema browser", () => {
  describe("given the schema endpoint answered for this member", () => {
    describe("when the browser renders", () => {
      /** @scenario "An authorized member opens Custom query and sees only their live governed schema" */
      it("lists exactly the datasets the response returned", () => {
        renderBrowser();

        for (const name of SCHEMA_DATASET_NAMES) {
          expect(datasetToggle(name)).toBeInTheDocument();
        }
        // Nothing suggests reachable ClickHouse beyond those datasets.
        expect(screen.queryByText(/system\./)).not.toBeInTheDocument();
        expect(
          screen.queryByText(/information_schema/i),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the member expands a dataset", () => {
      /** @scenario "A dataset's documentation is browsable" */
      it("shows its description, grain, freshness, time column, join keys and example query", () => {
        renderBrowser();
        expand("analytics.traces_daily");

        expect(
          screen.getByText("One row per trace, rolled up by day."),
        ).toBeInTheDocument();
        expect(
          screen.getByText("one row per trace per day"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("up to 15 minutes behind ingestion"),
        ).toBeInTheDocument();
        expect(screen.getByText("time: occurred_on")).toBeInTheDocument();
        expect(
          screen.getByText("Joins on trace_id, project_id"),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", {
            name: "Insert example query for analytics.traces_daily",
          }),
        ).toBeInTheDocument();
      });

      /** @scenario "A dataset's documentation is browsable" */
      it("shows each column with its type, description and unit", () => {
        renderBrowser();
        expand("analytics.traces_daily");

        const column = screen.getByTestId("governed-schema-column-latency_ms");
        expect(within(column).getByText("Float64")).toBeInTheDocument();
        // The description rides on the row's tooltip rather than a line of its
        // own, so the list stays scannable.
        expect(column).toHaveAttribute(
          "title",
          "End to end latency of the trace.",
        );
        // The unit symbol verbatim, not spelled out: the copy rules exempt
        // standard symbols, and the browser must not invent a rendering the
        // schema response did not carry.
        expect(within(column).getByText("ms")).toBeInTheDocument();
      });

      /** @scenario "Unavailable columns are visibly disabled without exposing hidden values" */
      it("disables a withheld column and offers no way to put it in a query", () => {
        renderBrowser();
        expand("analytics.traces_daily");

        const withheld = screen.getByTestId(
          "governed-schema-column-total_cost",
        );
        expect(withheld).toHaveAttribute("aria-disabled", "true");
        expect(within(withheld).getByText("no access")).toBeInTheDocument();
        expect(withheld).toHaveAttribute(
          "title",
          "Needs permission to see costs.",
        );
        expect(
          screen.queryByRole("button", { name: "Insert column total_cost" }),
        ).not.toBeInTheDocument();
        // The available siblings keep theirs, so the absence above is the gate
        // rather than a browser that offers nothing.
        expect(
          screen.getByRole("button", { name: "Insert column latency_ms" }),
        ).toBeInTheDocument();
      });
    });

    describe("when the member picks something to write into the editor", () => {
      /** @scenario "The member inserts schema elements into the editor" */
      it("inserts the column name or the example query", () => {
        const { onInsert } = renderBrowser();

        expand("analytics.traces_daily");

        fireEvent.click(
          screen.getByRole("button", { name: "Insert column latency_ms" }),
        );
        expect(onInsert).toHaveBeenCalledWith(
          "analytics.traces_daily.latency_ms",
        );

        fireEvent.click(
          screen.getByRole("button", {
            name: "Insert example query for analytics.traces_daily",
          }),
        );
        expect(onInsert).toHaveBeenCalledWith(
          SCHEMA_RESPONSE.datasets[0]!.exampleSql,
        );
      });
    });

    describe("when the member searches the browser", () => {
      /** @scenario "A search narrows the schema browser" */
      it("leaves only the datasets and columns that match", () => {
        renderBrowser();

        fireEvent.change(screen.getByRole("searchbox"), {
          target: { value: "latency" },
        });

        expect(datasetToggle("analytics.traces_daily")).toBeInTheDocument();
        expect(
          queryDatasetToggle("analytics.evaluations_daily"),
        ).not.toBeInTheDocument();

        expand("analytics.traces_daily");
        expect(
          screen.getByTestId("governed-schema-column-latency_ms"),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("governed-schema-column-trace_id"),
        ).not.toBeInTheDocument();
      });
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * The native result table: what it puts in the document, and what it keeps out
 * of it.
 *
 * ## Making virtualization observable in jsdom
 *
 * `@tanstack/react-virtual` measures its scroll element with
 * `offsetWidth`/`offsetHeight` (`virtual-core`'s `getRect`), and jsdom performs
 * no layout, so both are `0` and the window would collapse to a couple of rows
 * whether or not virtualization worked. Stubbing them gives the virtualizer a
 * real viewport, which is what makes "only a bounded window is materialized"
 * a claim this suite can actually fail.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LangWatchQLQueryResult } from "~/server/analytics/lwql";

import { LangWatchQLResultTable } from "@langwatch/analytics-web";

import { lwqlResult } from "@langwatch/analytics-web/testing";

/** The height the stubbed viewport reports, in pixels. */
const VIEWPORT_HEIGHT = 480;

/** The backend's row ceiling — what the table has to stay usable at. */
const ROW_CEILING = 10_000;

function renderTable(result: LangWatchQLQueryResult) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangWatchQLResultTable result={result} />
    </ChakraProvider>,
  );
}

function renderedRowIndexes(): number[] {
  return screen
    .queryAllByTestId("lwql-result-row")
    .map((row) => Number(row.getAttribute("data-index")));
}

beforeEach(() => {
  for (const [property, value] of [
    ["offsetHeight", VIEWPORT_HEIGHT],
    ["offsetWidth", 900],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      value,
    });
  }
});

afterEach(() => {
  for (const property of ["offsetHeight", "offsetWidth"]) {
    Reflect.deleteProperty(HTMLElement.prototype, property);
  }
  cleanup();
  vi.restoreAllMocks();
});

describe("the LangWatchQL result table", () => {
  describe("given a result whose columns arrive in a defined order with ClickHouse types", () => {
    describe("when the table renders", () => {
      /** @scenario "Columns come from the response in backend order and expose ClickHouse types" */
      it("lays the columns out in exactly the response's order", () => {
        renderTable(
          lwqlResult({
            columns: [
              { name: "occurred_on", type: "Date" },
              { name: "trace_id", type: "String" },
              { name: "latency_ms", type: "Nullable(Float64)" },
            ],
            rows: [{ occurred_on: "2026-02-20", trace_id: "t-1", latency_ms: 12.5 }],
          }),
        );

        const headers = screen
          .getAllByRole("columnheader")
          .map((header) => header.textContent);
        expect(headers).toEqual([
          "occurred_onDate",
          "trace_idString",
          "latency_msNullable(Float64)",
        ]);
      });

      /** @scenario "Columns come from the response in backend order and expose ClickHouse types" */
      it("shows each ClickHouse type without the member opening anything", () => {
        renderTable(
          lwqlResult({
            columns: [
              { name: "occurred_on", type: "Date" },
              { name: "latency_ms", type: "Nullable(Float64)" },
            ],
            rows: [{ occurred_on: "2026-02-20", latency_ms: 12.5 }],
          }),
        );

        expect(
          screen.getAllByTestId("lwql-column-type").map((node) => node.textContent),
        ).toEqual(["Date", "Nullable(Float64)"]);
      });
    });
  });

  describe("given a result at the backend's row ceiling", () => {
    const atCeiling = () =>
      lwqlResult({
        columns: [
          { name: "trace_id", type: "String" },
          { name: "latency_ms", type: "Float64" },
        ],
        rows: Array.from({ length: ROW_CEILING }, (_, index) => ({
          trace_id: `trace-${index}`,
          latency_ms: index,
        })),
        statistics: {
          elapsedMs: 900,
          rowsRead: 4_000_000,
          bytesRead: 128_000_000,
          rowsReturned: ROW_CEILING,
        },
      });

    describe("when the member scrolls and navigates the table", () => {
      /** @scenario "A 10,000-row result stays usable in a semantic virtualized table" */
      it("materializes only a bounded window of the ten thousand rows", () => {
        renderTable(atCeiling());

        const rendered = renderedRowIndexes();
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(100);
        // The window is a window *of* ten thousand, not a short result.
        expect(rendered[0]).toBe(0);
      });

      /** @scenario "A 10,000-row result stays usable in a semantic virtualized table" */
      it("moves the window to the rows the member scrolled to", () => {
        renderTable(atCeiling());
        const before = renderedRowIndexes();

        const scroller = screen.getByTestId("lwql-result-scroll");
        scroller.scrollTop = 100_000;
        fireEvent.scroll(scroller);

        const after = renderedRowIndexes();
        expect(after.length).toBeGreaterThan(0);
        expect(after.length).toBeLessThan(100);
        // A different part of the result, not the same rows re-rendered.
        expect(after[0]).toBeGreaterThan(before.at(-1) ?? 0);
      });

      /** @scenario "A 10,000-row result stays usable in a semantic virtualized table" */
      it("stays a semantic table with headers that hold their place while scrolling", () => {
        renderTable(atCeiling());

        // A real table, so row and column relationships survive for a screen
        // reader rather than being a grid of styled boxes.
        const table = screen.getByRole("table");
        expect(table.tagName).toBe("TABLE");
        expect(within(table).getAllByRole("columnheader")).toHaveLength(2);

        for (const header of screen.getAllByRole("columnheader")) {
          expect(header.style.position).toBe("sticky");
          expect(header.style.top).toBe("0px");
        }
      });

      /** @scenario "A 10,000-row result stays usable in a semantic virtualized table" */
      it("keeps a wide result scrolling inside its own container", () => {
        renderTable(atCeiling());

        const scroller = screen.getByTestId("lwql-result-scroll");
        expect(scroller.style.overflowX).toBe("auto");
        expect(scroller.style.overflowY).toBe("auto");
        // Reachable and scrollable from the keyboard, not only by pointer.
        expect(scroller).toHaveAttribute("tabindex", "0");
        expect(scroller).toHaveAccessibleName("Query result rows");
      });
    });
  });

  describe("given a result containing arrays, maps, tuples, and nested objects", () => {
    const nested = {
      counts: [1, 2, 3],
      labels: { env: "prod", region: "eu" },
    };
    const structured = () =>
      lwqlResult({
        columns: [{ name: "attributes", type: "Map(String, String)" }],
        rows: [{ attributes: nested }],
      });

    describe("when those cells render", () => {
      /** @scenario "Structured values render bounded, readable, and copyable" */
      it("shows a bounded readable representation in the cell", () => {
        renderTable(structured());

        expect(screen.getByText(JSON.stringify(nested))).toBeInTheDocument();
      });

      /** @scenario "Structured values render bounded, readable, and copyable" */
      it("expands to the whole value and copies it in full", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText },
        });

        renderTable(structured());

        fireEvent.click(
          screen.getByRole("button", {
            name: "Show the full value of attributes",
          }),
        );

        expect(await screen.findByTestId("lwql-value-full")).toHaveTextContent("counts");

        fireEvent.click(
          screen.getByRole("button", {
            name: "Copy the full value of attributes",
          }),
        );

        // The underlying value, not the bounded rendering of it.
        expect(writeText).toHaveBeenCalledWith(JSON.stringify(nested));
      });
    });
  });

  describe("given a cell whose value contains newlines", () => {
    const multiline = "line one\nline two\nline three";
    const withNewlines = () =>
      lwqlResult({
        columns: [{ name: "message", type: "String" }],
        rows: [{ message: multiline }],
      });

    describe("when that cell renders in the table", () => {
      /**
       * Every row is one `ROW_HEIGHT`, and the virtualizer sizes the scroll
       * range from that constant rather than from measurement. A preview that
       * renders its own line breaks makes the row taller than the range it was
       * counted into, so the padding rows no longer add up and the scrollbar
       * stops matching the rows under it.
       */
      it("previews it on a single line", () => {
        renderTable(withNewlines());

        const preview = screen
          .getByTestId("lwql-result-row")
          .querySelector("[data-cell-kind='scalar']");

        expect(preview?.textContent).not.toContain("\n");
      });

      /**
       * Collapsing the preview loses the line breaks, so the value has to stay
       * reachable — otherwise the table would show a version of the value with
       * no way to get at the real one. Length is not what makes it expandable
       * here: this value is well under the clip limit.
       */
      it("still offers the whole value", async () => {
        renderTable(withNewlines());

        fireEvent.click(
          screen.getByRole("button", {
            name: "Show the full value of message",
          }),
        );

        const full = await screen.findByTestId("lwql-value-full");

        // Every line, not just the last one: the preview already showed a
        // version of the value with the breaks taken out, so a test that only
        // looks for "line three" would pass on a value missing its first two.
        expect(full).toBeVisible();
        expect(full.textContent).toBe(multiline);
      });
    });
  });

  describe("given a result whose columns list the same name twice", () => {
    describe("when the table renders", () => {
      /** @scenario "Duplicate result column names are surfaced, not silently merged" */
      it("warns that the repeated name carries one value per row", () => {
        renderTable(
          lwqlResult({
            columns: [
              { name: "total", type: "UInt64" },
              { name: "total", type: "Float64" },
            ],
            rows: [{ total: 7 }],
          }),
        );

        const warning = screen.getByTestId("lwql-duplicate-columns");
        expect(warning).toHaveTextContent("total");
        expect(warning).toHaveTextContent("one value per name");
      });

      /** @scenario "Duplicate result column names are surfaced, not silently merged" */
      it("says nothing when every column name is distinct", () => {
        renderTable(lwqlResult());

        expect(screen.queryByTestId("lwql-duplicate-columns")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a query that matched no rows", () => {
    describe("when the table renders", () => {
      /** @scenario "The table has intentional loading, empty, error, stale, and truncated states" */
      it("says the query matched nothing rather than showing a blank grid", () => {
        renderTable(
          lwqlResult({
            rows: [],
            statistics: {
              elapsedMs: 8,
              rowsRead: 0,
              bytesRead: 0,
              rowsReturned: 0,
            },
          }),
        );

        expect(screen.getByTestId("lwql-result-empty")).toHaveTextContent(
          "The query ran and matched no rows.",
        );
        // The columns stay on screen, so the member can see what they asked for.
        expect(screen.getAllByRole("columnheader")).toHaveLength(1);
      });
    });
  });
});

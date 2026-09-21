/**
 * @vitest-environment jsdom
 *
 * The Origin column. A row's origin badge is a facet chip: one click filters
 * the list by that origin, and the click never reaches the row, so the trace
 * drawer stays closed. A row with no origin shows a plain badge that filters
 * nothing.
 *
 * Spec: specs/traces-v2/origin-badge-filter.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilterStore } from "../../../../../../stores/filterStore";
import type { TraceListItem } from "../../../../../../types/trace";
import { NO_TRACE_EVENTS } from "../../../../../../types/trace";
import type { CellRenderContext } from "../../../types";
import { OriginCell } from "../SimpleCells";

/** A row carrying nothing the cell reads beyond its origin. */
function row(origin: string): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 0,
    name: "trace",
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
    origin,
  } as unknown as TraceListItem;
}

function cellContext(item: TraceListItem): CellRenderContext<TraceListItem> {
  return {
    row: item,
    density: {} as CellRenderContext<TraceListItem>["density"],
    densityMode: "comfortable",
    isExpanded: false,
    isSelected: false,
    isFocused: false,
    actions: {},
    enabledAddonIds: [],
  };
}

/** The cell inside a row whose click would open the trace drawer. */
function renderCell(item: TraceListItem, onRowClick = vi.fn()) {
  render(
    <ChakraProvider value={defaultSystem}>
      <div data-testid="row" onClick={onRowClick}>
        {OriginCell.render(cellContext(item))}
      </div>
    </ChakraProvider>,
  );
  return onRowClick;
}

const queryText = () => useFilterStore.getState().queryText;

beforeEach(() => {
  useFilterStore.getState().clearAll();
});

afterEach(cleanup);

describe("OriginCell", () => {
  describe("given a trace row with an origin", () => {
    /** @scenario "Clicking the origin badge toggles the origin facet" */
    it("filters the list by that origin on click, without opening the row", () => {
      const onRowClick = renderCell(row("application"));

      fireEvent.click(
        screen.getByRole("button", { name: 'Filter by origin "Application"' }),
      );

      expect(queryText()).toBe("origin:application");
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe("given a trace row with no origin value", () => {
    /** @scenario "A row with no origin is not a filter affordance" */
    it("renders a plain badge with no filter action", () => {
      renderCell(row(""));

      const badge = screen.getByTestId("row").firstElementChild;
      expect(badge?.tagName).toBe("SPAN");
      expect(screen.queryByRole("button")).toBeNull();
      fireEvent.click(badge!);
      expect(queryText()).toBe("");
    });
  });
});

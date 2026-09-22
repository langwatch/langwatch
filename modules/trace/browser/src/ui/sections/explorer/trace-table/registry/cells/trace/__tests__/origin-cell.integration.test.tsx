/**
 * @vitest-environment jsdom
 *
 * The origin badge is a facet chip: a click filters by that origin and never
 * reaches the row. A row with no origin shows a plain badge.
 * @see specs/traces-v2/origin-badge-filter.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useDensityTokens } from "../../../../../hooks/use-density-tokens.ts";
import type { TraceListItem } from "../../../../../types/trace.ts";
import { buildTracePlaceholderRows } from "../../../../skeleton-placeholders.ts";
import { OriginCell } from "../simple-cells.tsx";

/** A complete row carrying the one field the cell reads. */
function row(origin: TraceListItem["origin"]): TraceListItem {
  const [placeholder] = buildTracePlaceholderRows(1);
  if (!placeholder) throw new Error("no placeholder row built");
  return { ...placeholder, traceId: "t1", origin };
}

/** The cell as the table renders it, inside a row whose click opens the drawer. */
const Cell: React.FC<{ item: TraceListItem; onRowClick: () => void }> = ({ item, onRowClick }) => (
  <table>
    <tbody>
      <tr data-testid="row" onClick={onRowClick} onKeyDown={onRowClick}>
        <td>
          {OriginCell.render({
            row: item,
            density: useDensityTokens(),
            densityMode: "comfortable",
            isExpanded: false,
            isSelected: false,
            isFocused: false,
            actions: {},
            enabledAddonIds: [],
          })}
        </td>
      </tr>
    </tbody>
  </table>
);

function renderCell(item: TraceListItem) {
  const onRowClick = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <Cell item={item} onRowClick={onRowClick} />
    </ChakraProvider>,
  );
  return onRowClick;
}

const queryText = () => useExplorerStore.getState().queryText;

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});

afterEach(cleanup);

describe("OriginCell", () => {
  describe("given a trace row with an origin", () => {
    /** @scenario "Clicking the origin badge toggles the origin facet" */
    it("filters the list by that origin on click, without opening the row", () => {
      const onRowClick = renderCell(row("application"));

      fireEvent.click(screen.getByRole("button", { name: 'Filter by origin "Application"' }));

      expect(queryText()).toBe("origin:application");
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });

  describe("given a trace row with no origin value", () => {
    /** @scenario "A row with no origin is not a filter affordance" */
    it("renders a plain badge with no filter action", () => {
      renderCell(row(""));

      const badge = screen.getByTestId("row").querySelector("td")?.firstElementChild;
      expect(badge?.tagName).toBe("SPAN");
      expect(screen.queryByRole("button")).toBeNull();
      fireEvent.click(badge!);
      expect(queryText()).toBe("");
    });
  });
});

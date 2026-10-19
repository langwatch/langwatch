/**
 * @vitest-environment jsdom
 */

import { ListTable } from "@langwatch/design-system/list-table";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VirtualizedTableRows } from "../ops-virtualized-table-rows.tsx";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const VIEWPORT_ROWS = 400 / 40;
const OVERSCAN = 6;

/** The cards' shape: the scroller and the rows mount in the same commit. */
function ScrollingTable({ count }: { count: number }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollContainerRef} style={{ maxHeight: "400px", overflowY: "auto" }}>
      <ListTable density="compact" variant="embedded" scroll="external" rowHeight={40}>
        <ListTable.Body>
          <VirtualizedTableRows
            count={count}
            rowHeight={40}
            columnCount={1}
            overscan={OVERSCAN}
            scrollContainerRef={scrollContainerRef}
            renderRow={(index) => (
              <ListTable.Row>
                <ListTable.Cell>{`row ${index}`}</ListTable.Cell>
              </ListTable.Row>
            )}
          />
        </ListTable.Body>
      </ListTable>
    </div>
  );
}

describe("VirtualizedTableRows", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given 424 rows, above the virtualization threshold", () => {
    describe("when the scroller and the rows mount in the same commit", () => {
      /** @scenario "A virtualized ops table shows its rows on first open" */
      it("renders the first rows, bounded by the viewport and its overscan", async () => {
        render(<ScrollingTable count={424} />, { wrapper });

        expect(await screen.findByText("row 0")).not.toBeNull();
        const rendered = screen.getAllByText(/^row \d+$/);
        expect(rendered.length).toBeLessThanOrEqual(VIEWPORT_ROWS + 2 * OVERSCAN);
        expect(screen.queryByText(`row ${VIEWPORT_ROWS + 2 * OVERSCAN}`)).toBeNull();
      });
    });
  });

  describe("given rows under the threshold", () => {
    it("renders every row", () => {
      render(<ScrollingTable count={3} />, { wrapper });

      expect(screen.getByText("row 2")).not.toBeNull();
    });
  });
});

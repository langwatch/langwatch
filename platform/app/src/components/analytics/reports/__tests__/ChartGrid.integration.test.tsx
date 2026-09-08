/**
 * @vitest-environment jsdom
 *
 * The shared chart grid: cards move by their header and resize by their
 * corner, snapping to whole cells; a card can't shrink below one cell; a
 * resize into a neighbour pushes the neighbour down rather than covering it;
 * and a committed placement renders back at the same size.
 *
 * Pointer gestures are driven the way the grid library listens for them:
 * mousedown on the handle, mousemove and mouseup on the document. The grid is
 * given a fixed width so cell geometry is known: 8 columns of 86px with 16px
 * gaps in an 800px grid, 100px rows.
 *
 * @see specs/analytics/chart-grid-resize.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import { CHART_GRID_DRAG_HANDLE_CLASS, ChartGrid } from "../ChartGrid";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const GRID_WIDTH_PX = 800;
/** (800 - 7 * 16) / 8 */
const COLUMN_PX = 86;
const ROW_PX = 100;
const GAP_PX = 16;

const cardWidthPx = (colSpan: number) =>
  colSpan * COLUMN_PX + (colSpan - 1) * GAP_PX;
const cardHeightPx = (rowSpan: number) =>
  rowSpan * ROW_PX + (rowSpan - 1) * GAP_PX;

const place = ({
  graphId,
  gridColumn,
  gridRow,
  colSpan,
  rowSpan,
}: ChartGridPlacement): ChartGridPlacement => ({
  graphId,
  gridColumn,
  gridRow,
  colSpan,
  rowSpan,
});

function Card({
  id,
  withIframe = false,
}: {
  id: string;
  withIframe?: boolean;
}) {
  return (
    <div data-testid={`card-${id}`} style={{ height: "100%" }}>
      <div
        className={CHART_GRID_DRAG_HANDLE_CLASS}
        data-testid={`handle-${id}`}
      >
        {id}
      </div>
      {withIframe ? (
        <iframe title={`body-${id}`} data-testid={`iframe-${id}`} />
      ) : null}
    </div>
  );
}

function mount({
  placements,
  withIframe = false,
}: {
  placements: ChartGridPlacement[];
  withIframe?: boolean;
}) {
  const onPlacementsCommit =
    vi.fn<(placements: ChartGridPlacement[]) => void>();
  const view = render(
    <ChartGrid
      placements={placements}
      onPlacementsCommit={onPlacementsCommit}
      width={GRID_WIDTH_PX}
      renderCard={({ graphId }) => (
        <Card id={graphId} withIframe={withIframe} />
      )}
    />,
    { wrapper: Wrapper },
  );
  return { ...view, onPlacementsCommit };
}

const gridItemOf = (element: HTMLElement): HTMLElement => {
  const item = element.closest(".react-grid-item");
  if (!(item instanceof HTMLElement))
    throw new Error("card is not inside a grid item");
  return item;
};

const resizeHandleOf = (item: HTMLElement): HTMLElement => {
  const handle = item.querySelector(".react-resizable-handle");
  if (!(handle instanceof HTMLElement))
    throw new Error("grid item has no resize handle");
  return handle;
};

/**
 * Presses on `target`, moves by the given delta, and releases. A resize
 * settles in one move; a move that has to displace a neighbour is fed
 * intermediate positions, the way a real pointer arrives, so the grid sees
 * the card cross the neighbour rather than teleport past it.
 */
function drag({
  target,
  dx,
  dy,
  steps = 1,
}: {
  target: HTMLElement;
  dx: number;
  dy: number;
  steps?: number;
}) {
  const start = { clientX: 400, clientY: 300 };
  fireEvent.mouseDown(target, { ...start, button: 0 });
  for (let step = 1; step <= steps; step += 1) {
    fireEvent.mouseMove(document, {
      clientX: start.clientX + (dx * step) / steps,
      clientY: start.clientY + (dy * step) / steps,
    });
  }
  fireEvent.mouseUp(document, {
    clientX: start.clientX + dx,
    clientY: start.clientY + dy,
  });
}

const committed = (
  spy: ReturnType<typeof vi.fn<(p: ChartGridPlacement[]) => void>>,
) => {
  const last = spy.mock.calls.at(-1)?.[0];
  if (!last) throw new Error("nothing was committed");
  return Object.fromEntries(last.map((p) => [p.graphId, p]));
};

// jsdom lays nothing out, so every element's `offsetParent` is null — and the
// grid library declines to start a header drag from an element without one
// (it measures the drag against the parent). The parent element stands in
// for the layout box here; resizing needs no such measurement.
const offsetParentDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetParent",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});
afterAll(() => {
  if (offsetParentDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetParent",
      offsetParentDescriptor,
    );
  }
});

afterEach(() => {
  cleanup();
});

describe("ChartGrid", () => {
  describe("given a card four columns wide and three rows tall", () => {
    describe("when its corner is released between two grid lines", () => {
      /** @scenario "A drag lands on the nearest grid cell, not an arbitrary pixel" */
      it("snaps to the nearer line in each dimension", () => {
        const { getByTestId, onPlacementsCommit } = mount({
          placements: [
            place({
              graphId: "a",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
          ],
        });
        const item = gridItemOf(getByTestId("card-a"));

        // 1.4 columns wider and 0.4 rows taller: nearer five columns, three rows.
        drag({
          target: resizeHandleOf(item),
          dx: 1.4 * (COLUMN_PX + GAP_PX),
          dy: 0.4 * (ROW_PX + GAP_PX),
        });
        expect(committed(onPlacementsCommit).a).toEqual(
          place({
            graphId: "a",
            gridColumn: 0,
            gridRow: 0,
            colSpan: 5,
            rowSpan: 3,
          }),
        );

        // 0.6 columns wider again and 0.6 rows taller: nearer six columns, four rows.
        drag({
          target: resizeHandleOf(item),
          dx: 0.6 * (COLUMN_PX + GAP_PX),
          dy: 0.6 * (ROW_PX + GAP_PX),
        });
        expect(committed(onPlacementsCommit).a).toEqual(
          place({
            graphId: "a",
            gridColumn: 0,
            gridRow: 0,
            colSpan: 6,
            rowSpan: 4,
          }),
        );
      });
    });

    describe("when its corner is dragged far past the point where it would vanish", () => {
      /** @scenario "A card cannot be dragged smaller than one cell" */
      it("stops at one column by one row and stays on the grid", () => {
        const { getByTestId, onPlacementsCommit } = mount({
          placements: [
            place({
              graphId: "a",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
          ],
        });
        const item = gridItemOf(getByTestId("card-a"));

        drag({ target: resizeHandleOf(item), dx: -2000, dy: -2000 });

        expect(committed(onPlacementsCommit).a).toEqual(
          place({
            graphId: "a",
            gridColumn: 0,
            gridRow: 0,
            colSpan: 1,
            rowSpan: 1,
          }),
        );
        expect(getByTestId("card-a")).toBeInTheDocument();
      });
    });
  });

  describe("given two cards side by side with no free space between them", () => {
    describe("when the left card is dragged wider into the right card's space", () => {
      /** @scenario "A resize that would overlap a neighbor pushes it aside instead" */
      it("pushes the right card below rather than underneath, and both stay rendered", () => {
        const { getByTestId, onPlacementsCommit } = mount({
          placements: [
            place({
              graphId: "left",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
            place({
              graphId: "right",
              gridColumn: 4,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
          ],
        });
        const item = gridItemOf(getByTestId("card-left"));

        drag({
          target: resizeHandleOf(item),
          dx: 4 * (COLUMN_PX + GAP_PX),
          dy: 0,
        });

        const next = committed(onPlacementsCommit);
        expect(next.left).toEqual(
          place({
            graphId: "left",
            gridColumn: 0,
            gridRow: 0,
            colSpan: 8,
            rowSpan: 3,
          }),
        );
        expect(next.right).toEqual(
          place({
            graphId: "right",
            gridColumn: 4,
            gridRow: 3,
            colSpan: 4,
            rowSpan: 3,
          }),
        );
        expect(getByTestId("card-left")).toBeInTheDocument();
        expect(getByTestId("card-right")).toBeInTheDocument();
      });
    });
  });

  describe("given a card whose body is a sandboxed iframe", () => {
    describe("when its header is dragged down past its neighbour", () => {
      /** @scenario "Resizing and reordering stay separate gestures" */
      it("moves the card without changing its size, from a handle outside the iframe", () => {
        const { getByTestId, onPlacementsCommit } = mount({
          placements: [
            place({
              graphId: "a",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
            place({
              graphId: "b",
              gridColumn: 0,
              gridRow: 3,
              colSpan: 4,
              rowSpan: 3,
            }),
          ],
          withIframe: true,
        });
        const header = getByTestId("handle-a");
        expect(getByTestId("iframe-a").contains(header)).toBe(false);

        drag({ target: header, dx: 0, dy: 4 * (ROW_PX + GAP_PX), steps: 8 });

        const next = committed(onPlacementsCommit);
        const a = next.a;
        const b = next.b;
        if (!a || !b) throw new Error("expected a and b to be committed");
        expect(a.colSpan).toBe(4);
        expect(a.rowSpan).toBe(3);
        expect(a.gridRow).toBeGreaterThan(b.gridRow);
      });
    });

    describe("when its corner is dragged instead", () => {
      /** @scenario "Resizing and reordering stay separate gestures" */
      it("changes only the size, from a handle outside the iframe, and the body itself starts neither gesture", () => {
        const { getByTestId, onPlacementsCommit } = mount({
          placements: [
            place({
              graphId: "a",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
          ],
          withIframe: true,
        });
        const item = gridItemOf(getByTestId("card-a"));
        const corner = resizeHandleOf(item);
        expect(getByTestId("iframe-a").contains(corner)).toBe(false);

        drag({ target: corner, dx: 0, dy: 2 * (ROW_PX + GAP_PX) });
        expect(committed(onPlacementsCommit).a).toEqual(
          place({
            graphId: "a",
            gridColumn: 0,
            gridRow: 0,
            colSpan: 4,
            rowSpan: 5,
          }),
        );

        onPlacementsCommit.mockClear();
        drag({ target: getByTestId("iframe-a"), dx: 300, dy: 300 });
        expect(onPlacementsCommit).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a placement that matches none of the old size presets", () => {
    describe("when the grid is rendered from it again, as after a reload", () => {
      /** @scenario "A resized card keeps its new size after the page reloads" */
      it("renders the card at exactly that many columns and rows", () => {
        // A full-width card above it, so the grid has no gap to close.
        const { getByTestId } = mount({
          placements: [
            place({
              graphId: "top",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 8,
              rowSpan: 2,
            }),
            place({
              graphId: "a",
              gridColumn: 1,
              gridRow: 2,
              colSpan: 5,
              rowSpan: 4,
            }),
          ],
        });
        const item = gridItemOf(getByTestId("card-a"));

        expect(item.style.width).toBe(`${cardWidthPx(5)}px`);
        expect(item.style.height).toBe(`${cardHeightPx(4)}px`);
        expect(item.style.transform).toBe(
          `translate(${COLUMN_PX + GAP_PX}px,${2 * (ROW_PX + GAP_PX)}px)`,
        );
      });
    });
  });

  describe("given a drag that ends where it started", () => {
    describe("when the pointer is released", () => {
      it("commits nothing", () => {
        const { getByTestId, onPlacementsCommit } = mount({
          placements: [
            place({
              graphId: "a",
              gridColumn: 0,
              gridRow: 0,
              colSpan: 4,
              rowSpan: 3,
            }),
          ],
        });

        drag({ target: getByTestId("handle-a"), dx: 4, dy: 0 });

        expect(onPlacementsCommit).not.toHaveBeenCalled();
      });
    });
  });
});

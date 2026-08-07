export type GridLayout = {
  graphId: string;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
};

type GridItem = {
  id: string;
  colSpan: number;
  rowSpan: number;
};

type GridArea = {
  occupied: Set<string>;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

const cellKey = (col: number, row: number) => `${col},${row}`;

const isAreaFree = ({ occupied, col, row, colSpan, rowSpan }: GridArea) => {
  for (let c = col; c < col + colSpan; c++) {
    for (let r = row; r < row + rowSpan; r++) {
      if (c >= 2 || occupied.has(cellKey(c, r))) {
        return false;
      }
    }
  }
  return true;
};

const occupyArea = ({ occupied, col, row, colSpan, rowSpan }: GridArea) => {
  for (let c = col; c < col + colSpan; c++) {
    for (let r = row; r < row + rowSpan; r++) {
      occupied.add(cellKey(c, r));
    }
  }
};

/** Places one item at the first free position, marking the cells it takes. */
const placeItem = ({
  item,
  occupied,
}: {
  item: GridItem;
  occupied: Set<string>;
}): GridLayout => {
  const { colSpan, rowSpan } = item;

  // Find the first available position
  for (let row = 0; ; row++) {
    for (let col = 0; col <= 2 - colSpan; col++) {
      if (isAreaFree({ occupied, col, row, colSpan, rowSpan })) {
        occupyArea({ occupied, col, row, colSpan, rowSpan });
        return {
          graphId: item.id,
          gridColumn: col,
          gridRow: row,
          colSpan,
          rowSpan,
        };
      }
    }
  }
};

/**
 * Calculate grid positions for items after reordering.
 * This uses a simple row-by-row layout algorithm for a 2-column grid.
 */
export const calculateGridPositions = <T extends GridItem>(
  items: T[],
): GridLayout[] => {
  // Track which cells are occupied
  // Grid is 2 columns wide, rows are dynamically added
  const occupied = new Set<string>();

  return items.map((item) => placeItem({ item, occupied }));
};

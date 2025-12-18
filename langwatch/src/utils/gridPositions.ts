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

/**
 * Calculate grid positions for items after reordering.
 * This uses a simple row-by-row layout algorithm for a 2-column grid.
 */
export const calculateGridPositions = <T extends GridItem>(
  items: T[]
): GridLayout[] => {
  const layouts: GridLayout[] = [];

  // Track which cells are occupied
  // Grid is 2 columns wide, rows are dynamically added
  const occupied = new Set<string>();

  const cellKey = (col: number, row: number) => `${col},${row}`;

  const isAreaFree = (
    col: number,
    row: number,
    colSpan: number,
    rowSpan: number
  ) => {
    for (let c = col; c < col + colSpan; c++) {
      for (let r = row; r < row + rowSpan; r++) {
        if (c >= 2 || occupied.has(cellKey(c, r))) {
          return false;
        }
      }
    }
    return true;
  };

  const occupyArea = (
    col: number,
    row: number,
    colSpan: number,
    rowSpan: number
  ) => {
    for (let c = col; c < col + colSpan; c++) {
      for (let r = row; r < row + rowSpan; r++) {
        occupied.add(cellKey(c, r));
      }
    }
  };

  for (const item of items) {
    const { colSpan, rowSpan } = item;

    // Find the first available position
    let placed = false;
    let row = 0;

    while (!placed) {
      for (let col = 0; col <= 2 - colSpan; col++) {
        if (isAreaFree(col, row, colSpan, rowSpan)) {
          occupyArea(col, row, colSpan, rowSpan);
          layouts.push({
            graphId: item.id,
            gridColumn: col,
            gridRow: row,
            colSpan,
            rowSpan,
          });
          placed = true;
          break;
        }
      }
      if (!placed) {
        row++;
      }
    }
  }

  return layouts;
};


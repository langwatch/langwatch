import { Table } from "@langwatch/design-system/primitives";

/** The empty row a virtualised body keeps above or below the rendered rows, holding the scroll. */
export function VirtualPaddingRow({ height, columns }: { height: number; columns: number }) {
  return (
    <Table.Row>
      <Table.Cell
        aria-hidden="true"
        style={{ height: `${height}px`, padding: 0 }}
        colSpan={columns}
      />
    </Table.Row>
  );
}

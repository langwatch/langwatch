# List tables

Index pages that list resources (datasets, settings entries, and the like)
use one shared table look so they read consistently. That look lives in
`src/components/ui/ListTable.tsx`. Use it for any new list page; do not restyle
a Chakra `Table.Root` per page.

```tsx
import { Table } from "@chakra-ui/react";
import { ListTable } from "~/components/ui/ListTable";

<ListTable>
  <Table.Header>
    <Table.Row>
      <Table.ColumnHeader>Name</Table.ColumnHeader>
      <Table.ColumnHeader>Columns</Table.ColumnHeader>
      <Table.ColumnHeader width={20}></Table.ColumnHeader>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {rows.map((row) => (
      <Table.Row key={row.id}>
        <Table.Cell>{row.name}</Table.Cell>
        <Table.Cell>{row.columns}</Table.Cell>
        <Table.Cell>{/* row actions menu */}</Table.Cell>
      </Table.Row>
    ))}
  </Table.Body>
</ListTable>
```

`ListTable` renders the bordered container and the `Table.Root`; you compose the
normal `Table.Header` / `Table.Body` / `Table.Row` / `Table.Cell` /
`Table.ColumnHeader` parts as children. Any extra `Table.Root` props (for
example `size`) pass straight through.

## What the standard look is

- A rounded container with an emphasized outer border (`border.emphasized`),
  full width, that clips the corners so the grid sits inside the radius.
- A taller header row, so the column labels have room and the header reads as a
  distinct band.
- A quiet light-gray grid: every cell is separated from its neighbours by a
  `border.muted` line, horizontally and vertically. It echoes the dataset
  editor table without the heavier chrome.
- Comfortable left padding on the first column so the leading content does not
  hug the border, balanced by right padding on the last column (usually the row
  actions menu).

Keep the page-level padding outside `ListTable` (the page owns its margins); the
component only owns the table itself.

## Adopting it

New list pages use `ListTable` from the start. Existing pages still on a bare
`Table.Root variant="line"` can move over opportunistically when they are next
touched. The row actions menu in the last column follows
[row-actions-overflow-menu](./row-actions-overflow-menu.md), and bulk selection
follows [selection-action-bar](./selection-action-bar.md).

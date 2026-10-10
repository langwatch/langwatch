import { ListTable } from "@langwatch/design-system/list-table";
import { Box, Table } from "@langwatch/design-system/primitives";
import type { OpsBlobSummary } from "@langwatch/ops-contract";

import { BlobRow } from "./blob-row.tsx";

export function BlobTable({
  blobs,
  canManage,
  onDelete,
}: {
  blobs: OpsBlobSummary[];
  canManage: boolean;
  onDelete: (blob: OpsBlobSummary) => void;
}) {
  return (
    <Box overflowX="auto">
      <ListTable
        density="compact"
        columnRules={false}
        containerProps={{ overflowX: "auto" }}
        variant="line"
        size="sm"
      >
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Project</Table.ColumnHeader>
            <Table.ColumnHeader>Payload</Table.ColumnHeader>
            <Table.ColumnHeader>Size</Table.ColumnHeader>
            <Table.ColumnHeader>Expires in</Table.ColumnHeader>
            <Table.ColumnHeader>Referenced by</Table.ColumnHeader>
            <Table.ColumnHeader>Holder stopped</Table.ColumnHeader>
            <Table.ColumnHeader>Next cleanup</Table.ColumnHeader>
            <Table.ColumnHeader />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {blobs.map((blob) => (
            <BlobRow
              key={`${blob.projectId}/${blob.hash}`}
              blob={blob}
              canManage={canManage}
              onDelete={onDelete}
            />
          ))}
        </Table.Body>
      </ListTable>
    </Box>
  );
}

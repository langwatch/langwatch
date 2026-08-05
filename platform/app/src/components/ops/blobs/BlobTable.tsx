import { Box, Table } from "@chakra-ui/react";

import type { OpsBlobSummary } from "~/server/app-layer/ops/types";

import { BlobRow } from "./BlobRow";

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
      <Table.Root variant="line" size="sm">
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
      </Table.Root>
    </Box>
  );
}

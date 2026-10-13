import { ListTable } from "@langwatch/design-system/list-table";
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
    <ListTable density="compact" scroll="x" scrollLabel="Stored payloads table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Project</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Payload</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Size</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Expires in</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Referenced by</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Holder stopped</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Next cleanup</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {blobs.map((blob) => (
          <BlobRow
            key={`${blob.projectId}/${blob.hash}`}
            blob={blob}
            canManage={canManage}
            onDelete={onDelete}
          />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

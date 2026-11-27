// Removing a braid says what stops before it happens, and that the removal is audited.

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Text } from "@langwatch/design-system/primitives";

import type { BraidRow } from "../../../model/braids/braids.ts";
import { BraidCondition } from "../../elements/braid-condition.tsx";

export type RemoveBraidDialogProps = {
  /** The braid being removed; none closes the dialog. */
  row: BraidRow | null;
  projectName: string;
  isRemoving: boolean;
  onConfirm: (row: BraidRow) => void;
  onClose: () => void;
};

function whatStops({ row, projectName }: { row: BraidRow; projectName: string }): string {
  const other = row.otherProject.name;
  const [reader, owner] = row.side === "into" ? [other, projectName] : [projectName, other];
  return `${reader} stops seeing ${owner} spans within 30 seconds. Nothing was copied, so nothing is left behind. The removal is recorded in the audit log.`;
}

export function RemoveBraidDialog({
  row,
  projectName,
  isRemoving,
  onConfirm,
  onClose,
}: RemoveBraidDialogProps) {
  const other = row?.otherProject.name ?? "";
  return (
    <ConfirmDialog
      open={row !== null}
      onClose={onClose}
      title={row?.side === "from" ? `Remove braid from ${other}?` : `Remove braid into ${other}?`}
      description={row ? whatStops({ row, projectName }) : ""}
      confirmLabel="Remove braid"
      tone="danger"
      loading={isRemoving}
      onConfirm={() => {
        if (row) onConfirm(row);
      }}
    >
      {row ? (
        <Text as="div" fontSize="sm">
          <BraidCondition where={row.where} />
        </Text>
      ) : null}
    </ConfirmDialog>
  );
}

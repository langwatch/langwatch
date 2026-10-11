/** The question asked before a sitting ends with nothing handed over to a dataset. */

import { Dialog } from "@langwatch/design-system/dialog";

/** What the reviewer is asked before the session ends with no dataset. */
export const END_SESSION_QUESTION =
  "Are you sure you want to end this annotation session without adding to a dataset?";

export function EndSessionDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={END_SESSION_QUESTION}
      size="sm"
      placement="center"
      primaryAction={{ label: "Confirm", onClick: onConfirm }}
    />
  );
}

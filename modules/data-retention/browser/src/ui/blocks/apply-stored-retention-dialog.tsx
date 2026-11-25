import type { StoredPastRetention } from "@langwatch/data-retention-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

import { storedRetentionPrompt } from "../../model/stored-retention-copy.ts";

/** Offers to apply a just-saved shorter period to stored data; `counted` null if it can't count. */
export function ApplyStoredRetentionDialog({
  pending,
  isApplying,
  onApply,
  onDismiss,
}: {
  pending: { counted: StoredPastRetention | null } | null;
  isApplying: boolean;
  onApply: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <Dialog
      open={!!pending}
      onClose={onDismiss}
      size="md"
      title="Apply the new period to stored data?"
      primaryAction={{
        label: "Apply now",
        onClick: () => void onApply(),
        loading: isApplying,
        danger: true,
      }}
      cancelLabel="Not now"
      role="alertdialog"
    >
      {pending && <Text>{storedRetentionPrompt(pending)} This can't be undone.</Text>}
    </Dialog>
  );
}

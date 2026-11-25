import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

import type { DiscardTarget } from "../../behavior/use-discard-guard.ts";

/** Asks before closing the drawer or starting a new automation throws unsaved changes away. */
export function DiscardChangesDialog({
  pendingTarget,
  noun,
  onKeepEditing,
  onDiscard,
}: {
  pendingTarget: DiscardTarget | null;
  noun: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog
      open={pendingTarget !== null}
      onClose={onKeepEditing}
      title="Discard unsaved changes?"
      primaryAction={{ label: "Discard", onClick: onDiscard, danger: true }}
      secondaryAction={{ label: "Keep editing", onClick: onKeepEditing }}
    >
      <Text color="fg.muted" textStyle="sm">
        This {noun} has changes you haven't saved yet.{" "}
        {pendingTarget === "createNew"
          ? "Start a new automation and discard them?"
          : "Close the drawer and discard them?"}
      </Text>
    </Dialog>
  );
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";
import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";

/** Removing a tool is permanent, so it asks first and names the reversible alternative. */
export function RemoveToolDialog({
  pending,
  isRemoving,
  onCancel,
  onConfirm,
}: {
  pending: AiToolEntry | null;
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={pending !== null}
      onClose={onCancel}
      placement="center"
      role="alertdialog"
      title={`Remove ${pending?.displayName ?? "tool"}?`}
      busy={isRemoving}
      primaryAction={{
        label: "Remove tool",
        onClick: onConfirm,
        loading: isRemoving,
        danger: true,
      }}
    >
      <Text fontSize="sm" color="fg.muted">
        This removes the tool from the catalog and from every member&apos;s tools page, and it
        cannot be undone. To take it off their page without losing how it is set up, unpublish it
        instead.
      </Text>
    </Dialog>
  );
}

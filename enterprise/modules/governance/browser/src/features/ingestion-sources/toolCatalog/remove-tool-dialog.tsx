// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button, Text } from "@chakra-ui/react";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@langwatch/design-system/dialog";
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
    <DialogRoot
      open={pending !== null}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
      placement="center"
    >
      {pending && (
        <DialogContent background="bg">
          <DialogCloseTrigger />
          <DialogHeader>
            <DialogTitle>Remove {pending.displayName}?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Text fontSize="sm" color="fg.muted">
              This removes the tool from the catalog and from every member&apos;s tools page, and it
              cannot be undone. To take it off their page without losing how it is set up, unpublish
              it instead.
            </Text>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button colorPalette="red" loading={isRemoving} onClick={onConfirm}>
              Remove tool
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </DialogRoot>
  );
}

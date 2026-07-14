import { Button, HStack, Input, Stack } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../../../../components/ui/dialog";

interface LensNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  /** Header text — e.g. "Save changes as new lens". */
  title: string;
  onSubmit: (name: string) => void;
}

/**
 * Chakra-dialog version of the "name this new lens" prompt. Used from
 * places that can't host an anchored popover (right-click menus, where
 * the menu closes before a popover gets a chance to render; and the
 * unsaved-changes prompt's Save-as-new hand-off). The Toolbar's Save
 * Lens button uses `LensNamePopover` instead so it stays attached to
 * its trigger.
 */
export const LensNameDialog: React.FC<LensNameDialogProps> = ({
  open,
  onOpenChange,
  defaultName = "",
  title,
  onSubmit,
}) => {
  const [name, setName] = useState(defaultName);

  // Reset the input every time the dialog opens — keeps stale state
  // from leaking between successive opens.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      size="sm"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Stack gap={3}>
            <Input
              autoFocus
              size="sm"
              placeholder="Lens name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                else if (e.key === "Escape") onOpenChange(false);
              }}
            />
          </Stack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2} justify="flex-end" width="full">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={submit}
              disabled={!name.trim()}
            >
              Create
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

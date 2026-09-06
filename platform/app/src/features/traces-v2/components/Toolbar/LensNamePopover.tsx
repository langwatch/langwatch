import { Button, HStack, Input, Stack } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../../../components/ui/popover";

interface LensNamePopoverProps {
  /** Pre-fill the name input (e.g. "All (copy)"). */
  defaultName?: string;
  /** Triggered with the trimmed lens name when the user confirms. */
  onSubmit: (name: string) => void;
  /**
   * Render-prop for the trigger button. Receives no args — the popover
   * owns its own open/close state. Use `asChild`-style composition so
   * the trigger keeps full control of its visuals.
   */
  children: React.ReactNode;
  /** Popover content width. Defaults to 280px to match CreateLensButton. */
  width?: string;
  /** Anchor placement. Defaults to bottom-end (right-aligned triggers). */
  placement?: "bottom-start" | "bottom-end";
  /** Optional content rendered under the input (e.g. a beta disclaimer). */
  footer?: React.ReactNode;
}

/**
 * Shared "name this new lens" popover used by every save-as-new entry
 * point (Toolbar Save Lens, the inline + new-lens button, lens tab
 * right-click → Save as new, lens draft dot → Save as new). One Chakra
 * popover everywhere replaces the legacy `window.prompt` dialogs
 * scattered across the codebase.
 */
export const LensNamePopover: React.FC<LensNamePopoverProps> = ({
  defaultName = "",
  onSubmit,
  children,
  width = "280px",
  placement = "bottom-end",
  footer,
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);

  const reset = () => {
    setOpen(false);
    setName(defaultName);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    reset();
  };

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) setName(defaultName);
      }}
      positioning={{ placement }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent width={width}>
        <PopoverBody>
          <Stack gap={3}>
            <HStack gap={2}>
              <Input
                autoFocus
                size="sm"
                placeholder="Lens name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  else if (e.key === "Escape") reset();
                }}
              />
              <Button
                size="sm"
                colorPalette="blue"
                onClick={submit}
                disabled={!name.trim()}
              >
                Create
              </Button>
            </HStack>
            {footer}
          </Stack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

import { Button, HStack, Input } from "@chakra-ui/react";
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
}

/**
 * Shared "name this new lens" popover used by every save-as-new entry
 * point (Toolbar Save Lens, lens tab right-click → Save as new, lens
 * draft dot → Save as new). One Chakra popover everywhere replaces the
 * legacy `window.prompt` dialogs scattered across the codebase.
 */
export const LensNamePopover: React.FC<LensNamePopoverProps> = ({
  defaultName = "",
  onSubmit,
  children,
  width = "280px",
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
      positioning={{ placement: "bottom-end" }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent width={width}>
        <PopoverBody>
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
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

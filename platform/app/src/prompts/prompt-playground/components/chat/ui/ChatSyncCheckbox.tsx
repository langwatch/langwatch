import { Box, type BoxProps } from "@chakra-ui/react";
import { Checkbox } from "~/components/ui/checkbox";

/**
 * Sync checkbox for enabling/disabling chat sync across tabs.
 * Single Responsibility: Renders a checkbox with label for sync toggle.
 */
export interface ChatSyncCheckboxProps extends Omit<BoxProps, "onChange"> {
  /** Whether sync is currently enabled */
  checked: boolean;
  /** Handler for sync toggle */
  onChange: (checked: boolean) => void;
  /** Whether the checkbox is visible (for hover states) */
  visible?: boolean;
}

/**
 * Checkbox component for syncing state across tabs in the prompt studio.
 * Single Responsibility: Toggle sync behavior with optional visibility control via opacity.
 */
export function ChatSyncCheckbox({
  checked,
  onChange,
  visible = true,
  ...boxProps
}: ChatSyncCheckboxProps) {
  return (
    <Box
      opacity={visible ? 1 : 0}
      transition="opacity 0.2s"
      pointerEvents={visible ? "auto" : "none"}
      marginBottom={-1}
      {...boxProps}
    >
      <Checkbox
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        size="xs"
        colorPalette="orange"
      >
        <Box fontSize="xs" color="fg.muted">
          Sync across tabs
        </Box>
      </Checkbox>
    </Box>
  );
}

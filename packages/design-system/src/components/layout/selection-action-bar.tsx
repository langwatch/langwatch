import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";

export interface SelectionActionBarProps {
  /** Left-side content, usually the "N selected" count (string or node); it wraps. */
  label: ReactNode;
  /** Clears the selection: the trailing X button. */
  onClear: () => void;
  /** Action buttons for the selection, after a divider; they wrap under the label. */
  children?: ReactNode;
  testId?: string;
  /**
   * `floating` (default): fixed bottom-centre of the viewport. `inline`: one band in normal
   * flow, for drawers, dialogs and tables inside a card.
   */
  placement?: "floating" | "inline";
  /** The `id` of the ListTable this bar acts on; Clear returns focus to its select-all box. */
  forTable?: string;
}

const FLOATING = {
  position: "fixed",
  bottom: "calc(24px + env(safe-area-inset-bottom))",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 20,
  maxWidth: "calc(100vw - 32px)",
  boxShadow: "lg",
  // Anyone else who floats at the bottom-center (Langy's armed-mode hint)
  // reads this to stack above the bar instead of landing on top of it.
  "data-bottom-floating-bar": "",
} as const;

/**
 * Resolved after the frame, because clearing rebuilds the header. Focus stays wherever the user
 * moved meanwhile, and a missing or disabled select-all is left alone.
 */
function focusSelectAllNextFrame({
  table,
  clearButton,
}: {
  table: string | undefined;
  clearButton: HTMLElement | null;
}) {
  if (!table) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    const moved = active && active !== document.body && active !== clearButton;
    if (moved) return;
    const box = document.getElementById(table)?.querySelector("[data-select-all]");
    if (!(box instanceof HTMLElement) || !box.isConnected) return;
    if (box instanceof HTMLInputElement && box.disabled) return;
    if (box.getAttribute("aria-disabled") === "true") return;
    box.focus();
  });
}

/**
 * The selection action bar: one shared shell so every bulk-selection surface looks the same.
 * Floating by default; `placement="inline"` sits in flow. Shown only while something is selected.
 * UX contract: dev/docs/best_practices/selection-action-bar.md.
 */
export function SelectionActionBar({
  label,
  onClear,
  children,
  testId,
  placement = "floating",
  forTable,
}: SelectionActionBarProps) {
  const floating = placement === "floating";
  const clearRef = useRef<HTMLButtonElement>(null);
  return (
    <Box
      as="fieldset"
      aria-label="Selection actions"
      bg="bg.panel"
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      minWidth={0}
      data-testid={testId}
      data-placement={placement}
      {...(floating ? FLOATING : { width: "full" })}
    >
      <Flex gap={2} align="center" wrap="wrap" minWidth={0}>
        {typeof label === "string" ? (
          <Text textStyle="sm" fontWeight="medium">
            {label}
          </Text>
        ) : (
          label
        )}
        {children && (
          <>
            <Box
              width="1px"
              height="20px"
              bg="border.muted"
              marginX={1}
              aria-hidden
              display={{ base: "none", sm: "block" }}
            />
            <Flex gap={2} align="center" wrap="wrap" minWidth={0}>
              {children}
            </Flex>
          </>
        )}
        <Button
          ref={clearRef}
          size="xs"
          variant="ghost"
          marginStart="auto"
          onClick={() => {
            onClear();
            focusSelectAllNextFrame({ table: forTable, clearButton: clearRef.current });
          }}
          aria-label="Clear selection"
        >
          <X size={14} />
        </Button>
      </Flex>
    </Box>
  );
}

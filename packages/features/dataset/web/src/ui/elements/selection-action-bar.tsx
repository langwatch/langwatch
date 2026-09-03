/**
 * Floating selection action bar: pinned to the bottom-center of the viewport
 * while rows are selected, holding the selection count, the actions for that
 * selection, and a clear-selection button.
 *
 * A family-local copy of `platform/app/src/components/ui/SelectionActionBar`,
 * which the traces surfaces still render. Deletes-only forbids repointing them,
 * so the platform copy stays for its other consumers and this one travels with
 * the dataset editor. Byte-for-byte the same markup, including the
 * `data-bottom-floating-bar` attribute Langy's armed-mode hint reads to stack
 * above the bar instead of landing on top of it.
 *
 * UX contract: dev/docs/best_practices/selection-action-bar.md.
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function SelectionActionBar({
  label,
  onClear,
  children,
  testId,
}: {
  /** Left-side content, usually the "N selected" count (string or node). */
  label: ReactNode;
  /** Clears the selection: the trailing X button. */
  onClear: () => void;
  /** Action buttons for the current selection, rendered after a divider. */
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Box
      position="fixed"
      bottom={6}
      left="50%"
      transform="translateX(-50%)"
      zIndex={20}
      bg="bg.panel"
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      boxShadow="lg"
      data-bottom-floating-bar=""
      data-testid={testId}
    >
      <HStack gap={2} align="center" whiteSpace="nowrap">
        {typeof label === "string" ? (
          <Text textStyle="sm" fontWeight="medium">
            {label}
          </Text>
        ) : (
          label
        )}
        {children && (
          <>
            <Box width="1px" height="20px" bg="border.muted" marginX={1} />
            {children}
          </>
        )}
        <Button size="xs" variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X size={14} />
        </Button>
      </HStack>
    </Box>
  );
}

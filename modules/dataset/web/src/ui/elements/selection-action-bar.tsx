/** Floating selection action bar (bottom-center). Family-local copy,
 * byte-for-byte match.
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

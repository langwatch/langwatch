import { Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One block of the review overview: what this part of the automation says, and
 * the affordance that enters its step alone.
 *
 * Editing is hub-and-spoke (ADR-093 §4) — the overview is home, so every edit
 * from here is a round trip that comes straight back. The button carries an
 * explicit accessible name because "Edit" on its own tells a screen reader
 * nothing about which of the two blocks it belongs to.
 */
export function ReviewSection({
  title,
  summary,
  editLabel,
  onEdit,
  children,
}: {
  title: string;
  /** The one-line answer this section currently holds. */
  summary: string;
  /** Accessible name for the edit affordance, e.g. "Edit what it watches". */
  editLabel: string;
  onEdit: () => void;
  /** Optional detail lines under the summary. */
  children?: ReactNode;
}) {
  return (
    <Box padding={3} borderRadius="md" borderWidth="1px" borderColor="border">
      <HStack gap={2} align="start">
        <VStack align="start" gap={0.5} flex="1" minWidth="0">
          <Text textStyle="xs" color="fg.muted" fontWeight="semibold">
            {title}
          </Text>
          <Text textStyle="sm" fontWeight="medium">
            {summary}
          </Text>
          {children}
        </VStack>
        <Spacer />
        <Button
          size="xs"
          variant="outline"
          flexShrink={0}
          aria-label={editLabel}
          onClick={onEdit}
        >
          <Pencil size={12} aria-hidden="true" /> Edit
        </Button>
      </HStack>
    </Box>
  );
}

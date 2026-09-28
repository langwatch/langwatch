/**
 * The pieces of a board with nothing on it yet, after the reference: the
 * dashed "Add a block" target that opens the question-first picker, and the
 * "Start from a template" strip offering the Agent Flight Deck.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Gauge, Plus } from "lucide-react";

import { FLIGHT_DECK } from "../../model/boards.ts";

/** Full-bleed on an empty board, a compact footer once blocks fill the page above it. */
export function AddBlockCard({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <Button
      variant="plain"
      height="auto"
      width="full"
      flexDirection="column"
      gap={2}
      paddingX={6}
      paddingY={compact ? 8 : 16}
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      borderRadius="2xl"
      color="fg.subtle"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "teal.emphasized", color: "teal.fg" }}
      onClick={onClick}
    >
      <Box borderRadius="full" background="bg.muted" padding={2.5}>
        <Plus size={18} aria-hidden />
      </Box>
      <Text fontSize="14px" fontWeight="medium">
        Add a block
      </Text>
      <Text fontSize="13px" color="fg.muted">
        Start from the question you need answered.
      </Text>
    </Button>
  );
}

export function TemplateStrip({ onOpen }: { onOpen: () => void }) {
  return (
    <VStack align="stretch" gap={2}>
      <Text
        paddingX={1}
        fontSize="10.5px"
        fontWeight="semibold"
        letterSpacing="0.09em"
        textTransform="uppercase"
        color="fg.subtle"
      >
        Start from a template
      </Text>
      <Button
        variant="outline"
        height="auto"
        justifyContent="flex-start"
        gap={3}
        paddingX={4}
        paddingY={3}
        borderRadius="xl"
        fontWeight="normal"
        onClick={onOpen}
      >
        <Box borderRadius="md" background="bg.muted" padding={2} color="teal.fg">
          <Gauge size={16} aria-hidden />
        </Box>
        <VStack align="start" gap={0} minWidth={0}>
          <Text fontSize="13px" fontWeight="medium" truncate>
            {FLIGHT_DECK.name}
          </Text>
          <Text fontSize="12px" color="fg.muted" truncate>
            {FLIGHT_DECK.description}
          </Text>
        </VStack>
      </Button>
    </VStack>
  );
}

/** Everything a blank board shows under its header. */
export function BlankBoard({
  onAddBlock,
  onOpenTemplate,
}: {
  onAddBlock: () => void;
  onOpenTemplate: () => void;
}) {
  return (
    <VStack align="stretch" gap={8}>
      <AddBlockCard onClick={onAddBlock} />
      <TemplateStrip onOpen={onOpenTemplate} />
    </VStack>
  );
}

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
      borderColor="border.emphasized/80"
      borderRadius="2xl"
      color="gray.400"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "teal.solid/60", color: "teal.solid" }}
      onClick={onClick}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={10}
        borderRadius="full"
        background="bg.muted"
      >
        <Plus size={18} aria-hidden />
      </Box>
      <Text fontSize="14px" fontWeight="medium">
        Add a block
      </Text>
      <Text fontSize="12.5px" color="fg.subtle">
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
        color="gray.400"
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
        borderColor="border"
        background="bg.panel"
        boxShadow="0 1px 2px rgb(16 16 32 / 0.03)"
        fontWeight="normal"
        _hover={{
          borderColor: "teal.solid/50",
          background: "bg.panel",
          boxShadow: "0 2px 8px rgb(16 16 32 / 0.06)",
        }}
        onClick={onOpen}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize={8}
          flexShrink={0}
          borderRadius="md"
          background="teal.solid/10"
          color="teal.solid"
        >
          <Gauge size={16} strokeWidth={2.1} aria-hidden />
        </Box>
        <VStack align="start" gap={0} minWidth={0}>
          <Text fontSize="13px" lineHeight="snug" fontWeight="medium" color="fg" truncate>
            {FLIGHT_DECK.name}
          </Text>
          <Text fontSize="12px" lineHeight="relaxed" color="fg.subtle" truncate>
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
    <VStack align="stretch" gap={5}>
      <AddBlockCard onClick={onAddBlock} />
      <TemplateStrip onOpen={onOpenTemplate} />
    </VStack>
  );
}

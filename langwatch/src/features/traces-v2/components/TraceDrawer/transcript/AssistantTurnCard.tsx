import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuBot } from "react-icons/lu";
import type { DisplayRoleVisuals } from "../scenarioRoles";
import { BlockStack } from "./BlockStack";
import type { ChatMessage, ContentBlock } from "./types";

export function AssistantTurnCard({
  blocks,
  toolCalls,
  visuals,
  collapseTools = false,
}: {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  /**
   * Optional label/icon override. Used when scenario mode swaps a `user`
   * source-role turn into the assistant-side card so the simulator reads
   * as the "assistant" with a flask icon.
   */
  visuals?: DisplayRoleVisuals;
  collapseTools?: boolean;
}) {
  // Operations = thinking + tool_use + tool_result (every block that isn't
  // user-facing output text). The header chip lets the user collapse them
  // away and read just the assistant's final reply, which is what they
  // usually came for.
  const operationCount = useMemo(
    () => blocks.filter((b) => b.kind !== "text").length + toolCalls.length,
    [blocks, toolCalls],
  );
  const hasOutputText = useMemo(
    () => blocks.some((b) => b.kind === "text"),
    [blocks],
  );
  // Default: collapse operations whenever there's a final text reply, so the
  // assistant's actual message reads first. The header toggle expands the
  // chain on demand. When there's no final text (pure tool/thinking turn),
  // keep ops visible — collapsing them would leave an empty card.
  const [opsHidden, setOpsHidden] = useState(hasOutputText);

  // When operations are hidden we still walk in chronological order, but
  // skip every non-text block. Falls back to the full list when there's
  // nothing else to show (so the empty-state stays meaningful).
  const visibleBlocks = useMemo(
    () =>
      opsHidden && hasOutputText
        ? blocks.filter((b) => b.kind === "text")
        : blocks,
    [opsHidden, hasOutputText, blocks],
  );
  const visibleToolCalls = opsHidden && hasOutputText ? [] : toolCalls;

  return (
    <Box
      mb="4"
      pl="4"
      borderStartWidth="2px"
      borderStartColor="purple.muted"
      bg="bg.panel"
      py="3"
      pr="3"
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
    >
      <HStack gap="1.5" mb="1.5">
        <Flex
          w="4"
          h="4"
          borderRadius="full"
          bg="purple.muted"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={visuals?.Icon ?? LuBot} size="2.5" color="purple.fg" />
        </Flex>
        <Text
          textStyle="2xs"
          color="purple.fg"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          {visuals?.bubbleLabel ?? "Assistant"}
        </Text>
        {!collapseTools && operationCount > 0 && hasOutputText && (
          <>
            <Box flex="1" />
            <Text
              as="button"
              type="button"
              onClick={() => setOpsHidden((v) => !v)}
              textStyle="2xs"
              color="fg.subtle"
              fontWeight="500"
              cursor="pointer"
              _hover={{ color: "fg.muted" }}
              transition="color 0.12s ease"
            >
              {opsHidden
                ? `Show ${operationCount} ${operationCount === 1 ? "step" : "steps"}`
                : `Hide ${operationCount === 1 ? "step" : "steps"}`}
            </Text>
          </>
        )}
      </HStack>
      <BlockStack
        blocks={visibleBlocks}
        toolCalls={visibleToolCalls}
        collapseTools={collapseTools}
      />
    </Box>
  );
}

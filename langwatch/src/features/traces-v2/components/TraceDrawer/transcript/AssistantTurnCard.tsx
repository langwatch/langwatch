import { Box, chakra, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuBot } from "react-icons/lu";
import type { DisplayRoleVisuals } from "../scenarioRoles";
import { BlockStack } from "./BlockStack";
import { getRolePalette } from "./RoleChip";
import { TurnCollapseChevron } from "./TurnCollapseChevron";
import type { ChatMessage, ContentBlock } from "./types";

export function AssistantTurnCard({
  blocks,
  toolCalls,
  visuals,
  collapseTools = false,
  onCollapse,
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
  onCollapse?: () => void;
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

  // Assistant-side bubble: always sourced from `ROLE_PALETTES.assistant`
  // (purple). This is the canonical "assistant side" colour; thread
  // layout reads the same palette via `getRolePalette("assistant")`,
  // so a scenario simulator (displayRole=assistant) renders purple
  // here AND in the thread chip.
  const palette = getRolePalette("assistant");
  return (
    <Box
      mb="4"
      pl="4"
      borderStartWidth="2px"
      borderStartColor={palette.muted}
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
          bg={palette.muted}
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={visuals?.Icon ?? LuBot} boxSize={2.5} color={palette.fg} />
        </Flex>
        <Text
          textStyle="2xs"
          color={palette.fg}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          {visuals?.bubbleLabel ?? "Assistant"}
        </Text>
        {!collapseTools && operationCount > 0 && hasOutputText && (
          <>
            <Box flex="1" />
            <chakra.button
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
            </chakra.button>
          </>
        )}
        {onCollapse && (
          <>
            {/* If the steps toggle wasn't rendered, push the chevron
                to the right edge with our own spacer. */}
            {!(!collapseTools && operationCount > 0 && hasOutputText) && (
              <Box flex="1" />
            )}
            <TurnCollapseChevron onClick={onCollapse} />
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

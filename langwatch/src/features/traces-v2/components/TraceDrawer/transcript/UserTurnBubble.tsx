import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { LuUser } from "react-icons/lu";
import { RenderedMarkdown } from "../markdownView";
import type { DisplayRoleVisuals } from "../scenarioRoles";
import { BlockStack } from "./BlockStack";
import { asMarkdownBody } from "./parsing";
import type { ChatMessage, ContentBlock } from "./types";

/**
 * User turn — renders every block the user message had. Pure-text turns
 * collapse into a right-aligned blue bubble (the canonical chat-user
 * look); turns with mixed blocks (text + thinking + tool_use) render
 * full-width with the same block stack as an assistant turn but with a
 * blue accent + "User" chip, so it's still obvious *which* role this turn
 * belonged to AND visible that it had thinking/tool_use/etc inside.
 */
export function UserTurnBubble({
  blocks,
  toolCalls,
  visuals,
  collapseTools = false,
}: {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  /**
   * Optional label/icon override. Used when scenario mode swaps an
   * `assistant` source-role turn into the user-side bubble so reviewers
   * see the agent under test as the trace's "user".
   */
  visuals?: DisplayRoleVisuals;
  collapseTools?: boolean;
}) {
  const HeaderIcon = visuals?.Icon ?? LuUser;
  const headerLabel = visuals?.bubbleLabel ?? "User";
  const onlyText = blocks.length > 0 && blocks.every((b) => b.kind === "text");

  // Pure-prose user message → classic chat bubble layout.
  if (onlyText) {
    const text = blocks
      .filter(
        (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
      )
      .map((b) => b.text)
      .join("\n");
    return (
      <Box marginBottom={4} display="flex" justifyContent="flex-end">
        <Box
          maxWidth="calc(100% - 24px)"
          bg="blue.subtle"
          borderRadius="lg"
          borderTopRightRadius="sm"
          paddingX={3.5}
          paddingY={2.5}
        >
          <HStack gap={1.5} marginBottom={1.5}>
            <Flex
              width="16px"
              height="16px"
              borderRadius="full"
              bg="blue.muted"
              align="center"
              justify="center"
              flexShrink={0}
            >
              <Icon as={HeaderIcon} boxSize="10px" color="blue.fg" />
            </Flex>
            <Text
              textStyle="2xs"
              color="blue.fg"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing="0.06em"
            >
              {headerLabel}
            </Text>
          </HStack>
          <Box color="fg" textStyle="xs" lineHeight="1.6">
            {text ? (
              <RenderedMarkdown
                markdown={asMarkdownBody(text)}
                paddingX={0}
                paddingY={0}
              />
            ) : (
              <Text>—</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  // Mixed-content user message (or empty). Render full-width with the
  // same block stack as an assistant turn but blue-accented.
  return (
    <Box
      marginBottom={4}
      paddingLeft={4}
      borderLeftWidth="2px"
      borderLeftColor="blue.muted"
    >
      <HStack gap={1.5} marginBottom={1.5}>
        <Flex
          width="16px"
          height="16px"
          borderRadius="full"
          bg="blue.muted"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={HeaderIcon} boxSize="10px" color="blue.fg" />
        </Flex>
        <Text
          textStyle="2xs"
          color="blue.fg"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          {headerLabel}
        </Text>
      </HStack>
      <BlockStack
        blocks={blocks}
        toolCalls={toolCalls}
        collapseTools={collapseTools}
      />
    </Box>
  );
}

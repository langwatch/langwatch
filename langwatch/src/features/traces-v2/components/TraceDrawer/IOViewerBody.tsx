import { Box, Text } from "@chakra-ui/react";
import { useColorMode } from "~/components/ui/color-mode";
import { RenderedMarkdown, ShikiCodeBlock } from "./markdownView";
import {
  AssistantTurnCard,
  type ChatLayout,
  type ContentBlock,
  type ConversationTurn,
  ConversationTurnsList,
} from "./transcript";
import type { MarkdownSubmode, ViewFormat } from "./useIOViewerState";

const COMPACT_MAX_HEIGHT_PX = 300;
const EXPANDED_MAX_HEIGHT_PX = 500;

interface IOViewerBodyProps {
  format: ViewFormat;
  isChat: boolean;
  canJson: boolean;
  prettyJsonContent: string;
  markdownBody: string;
  markdownSubmode: MarkdownSubmode;
  conversationTurns: ConversationTurn[];
  chatLayout: ChatLayout;
  inlineBlocks: ContentBlock[];
  hasInlineRichContent: boolean;
  displayContent: string;
  isLong: boolean;
  expanded: boolean;
  mode: "input" | "output";
}

/** Renders the format-dispatched body of the IOViewer panel. */
export function IOViewerBody({
  format,
  isChat,
  canJson,
  prettyJsonContent,
  markdownBody,
  markdownSubmode,
  conversationTurns,
  chatLayout,
  inlineBlocks,
  hasInlineRichContent,
  displayContent,
  isLong,
  expanded,
  mode,
}: IOViewerBodyProps) {
  const { colorMode } = useColorMode();

  if (format === "json" && canJson) {
    return (
      <ShikiCodeBlock
        code={prettyJsonContent}
        language="json"
        colorMode={colorMode}
        flush
      />
    );
  }
  if (format === "markdown") {
    return markdownSubmode === "rendered" ? (
      // Rendered markdown — proper formatting + Shiki for any fenced
      // code blocks inside. Lives behind the toggle because for very
      // long content the rendered path is heavier than source.
      <RenderedMarkdown markdown={markdownBody} paddingX={3} paddingY={2} />
    ) : (
      // Source — raw markdown with markdown syntax highlighting.
      // Plain text, copyable, lightning fast even on huge content.
      <ShikiCodeBlock
        code={markdownBody}
        language="markdown"
        colorMode={colorMode}
        flush
      />
    );
  }
  if (format === "pretty" && isChat) {
    return (
      <ConversationTurnsList
        turns={conversationTurns}
        layout={chatLayout}
        collapseTools={mode === "output"}
        maxHeightPx={
          isLong && !expanded ? COMPACT_MAX_HEIGHT_PX : EXPANDED_MAX_HEIGHT_PX
        }
      />
    );
  }
  if (format === "pretty" && hasInlineRichContent) {
    // Plain-string content with inline typed blocks (e.g. a flattened
    // agent transcript). Render under a single assistant turn card so
    // thinking/tool_use/tool_result get the same visual hierarchy as
    // structured chat — left accent bar, role chip, blocks stacked.
    return (
      <AssistantTurnCard
        blocks={inlineBlocks}
        toolCalls={[]}
        collapseTools={mode === "output"}
      />
    );
  }
  if (format === "pretty" && canJson) {
    return (
      <ShikiCodeBlock
        code={prettyJsonContent}
        language="json"
        colorMode={colorMode}
        flush
      />
    );
  }
  return (
    <Text
      textStyle="xs"
      color="fg"
      fontFamily="mono"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      lineHeight="tall"
    >
      {displayContent}
    </Text>
  );
}

/** Click-to-engage scrim for the idle preview state. */
export function IOViewerEngageScrim({
  flushChatCard,
  onEngage,
}: {
  flushChatCard: boolean;
  onEngage: () => void;
}) {
  return (
    <Box
      position="absolute"
      inset={0}
      cursor="zoom-in"
      onClick={onEngage}
      display="flex"
      alignItems="flex-end"
      justifyContent="center"
      paddingBottom={2}
      background="linear-gradient(to bottom, transparent 60%, var(--chakra-colors-bg-subtle) 100%)"
      borderRadius={flushChatCard ? "0" : "md"}
    >
      <Text
        textStyle="2xs"
        color="fg.muted"
        fontWeight="medium"
        bg="bg.surface"
        paddingX={2}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        borderColor="border"
      >
        Click to interact
      </Text>
    </Box>
  );
}

export { COMPACT_MAX_HEIGHT_PX, EXPANDED_MAX_HEIGHT_PX };

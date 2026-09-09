import { Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { RenderedMarkdown } from "../../../blocks/markdown/rendered-markdown.tsx";
import { ShikiCodeBlock } from "../../../elements/markdown/shiki-highlight.tsx";
import {
  AssistantTurnCard,
  type ChatLayout,
  type ContentBlock,
  type ConversationTurn,
  ConversationTurnsList,
} from "./transcript/index.ts";
import type { MarkdownSubmode, ViewFormat } from "./use-io-viewer-state.ts";

const COMPACT_MAX_HEIGHT_PX = 300;
const EXPANDED_MAX_HEIGHT_PX = 500;

// Structural Markdown signals. We render plain text as Markdown in Pretty mode only
// when one of these matches, so genuine prose / log dumps / stack traces (which carry
// none of these) keep the literal monospace pre-wrap and don't get reflowed.
const MARKDOWN_SIGNALS: RegExp[] = [
  /^#{1,6}\s+\S/m, // ATX heading
  /^\s*[-*+]\s+\S/m, // bullet list item
  /^\s*\d+\.\s+\S/m, // ordered list item
  /^\s*>\s+\S/m, // blockquote
  /```/, // fenced code block
  /\[[^\]\n]+\]\([^)\n]+\)/, // link
  /^\|.*\|\s*$\n^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/m, // table header + rule
  /(\*\*|__)(?=\S)[^\n]{1,200}?\S\1/, // bold
  /`[^`\n]{1,200}`/, // inline code
];

export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  // Markdown structure shows up early; cap the scan so a megabyte of plain
  // text doesn't pay a regex sweep.
  const sample = text.length > 4000 ? text.slice(0, 4000) : text;
  return MARKDOWN_SIGNALS.some((re) => re.test(sample));
}

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
    return <ShikiCodeBlock code={prettyJsonContent} language="json" colorMode={colorMode} flush />;
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
      <ShikiCodeBlock code={markdownBody} language="markdown" colorMode={colorMode} flush />
    );
  }
  if (format === "pretty") {
    const pretty = prettyBody({
      canJson,
      chatLayout,
      colorMode,
      conversationTurns,
      displayContent,
      expanded,
      hasInlineRichContent,
      inlineBlocks,
      isChat,
      isLong,
      mode,
      prettyJsonContent,
    });
    if (pretty) return pretty;
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

/**
 * Pretty mode's own dispatch: chat turns, inline rich blocks, JSON, or markdown
 * that reads as markdown. Returns null when nothing here fits and the caller
 * should fall through to the literal monospace block.
 */
function prettyBody({
  canJson,
  chatLayout,
  colorMode,
  conversationTurns,
  displayContent,
  expanded,
  hasInlineRichContent,
  inlineBlocks,
  isChat,
  isLong,
  mode,
  prettyJsonContent,
}: Pick<
  IOViewerBodyProps,
  | "canJson"
  | "chatLayout"
  | "conversationTurns"
  | "displayContent"
  | "expanded"
  | "hasInlineRichContent"
  | "inlineBlocks"
  | "isChat"
  | "isLong"
  | "mode"
  | "prettyJsonContent"
> & { colorMode: string }): ReactNode {
  if (isChat) {
    return (
      <ConversationTurnsList
        turns={conversationTurns}
        layout={chatLayout}
        collapseTools={mode === "output"}
        maxHeightPx={isLong && !expanded ? COMPACT_MAX_HEIGHT_PX : EXPANDED_MAX_HEIGHT_PX}
      />
    );
  }
  if (hasInlineRichContent) {
    // Plain-string content with inline typed blocks (e.g. a flattened
    // agent transcript). Render under a single assistant turn card so
    // thinking/tool_use/tool_result get the same visual hierarchy as
    // structured chat — left accent bar, role chip, blocks stacked.
    return (
      <AssistantTurnCard blocks={inlineBlocks} toolCalls={[]} collapseTools={mode === "output"} />
    );
  }
  if (canJson) {
    return <ShikiCodeBlock code={prettyJsonContent} language="json" colorMode={colorMode} flush />;
  }
  // Plain text in Pretty mode: if it reads as Markdown, render it richly so
  // Pretty is no longer a no-op vs the raw Text view. The "text" format
  // still falls straight through to the literal monospace block.
  if (!isLong && looksLikeMarkdown(displayContent)) {
    return <RenderedMarkdown markdown={displayContent} paddingX={3} paddingY={2} />;
  }
  return null;
}

/** Click-to-engage scrim for the idle preview state. */
export { COMPACT_MAX_HEIGHT_PX, EXPANDED_MAX_HEIGHT_PX };

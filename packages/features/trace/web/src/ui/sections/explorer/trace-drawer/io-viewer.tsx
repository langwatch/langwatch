import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { TRANSLATE_TEXT_MAX_CHARS } from "../../../../model/constants";
import type { TraceAnchor } from "../hooks/use-anchored-annotations";
import { useTextTranslation } from "../hooks/use-text-translation";
import { IOViewerBody } from "./io-viewer-body";
import { IOViewerToolbar } from "./io-viewer-toolbar";
import { safePrettyJson } from "../../../elements/explorer/trace-drawer/json-highlight";
import {
  applyChatTextLeaves,
  asMarkdownBody,
  type ChatMessage,
  type ConversationTurn,
  coerceToChatMessages,
  collectChatTextLeaves,
  extractInlineBlocks,
  groupMessagesIntoTurns,
  parseContentBlocks,
  tryParseJSON,
  VIRTUALIZE_AT,
} from "./transcript";
import { MessageCommentScope } from "./transcript/message-comments";
import { TraceMediaPart } from "../../traces/trace-media-part";
import { TerminalOutput } from "@langwatch/coding-agent-web";
import { TranscriptRenderProvider } from "../../../../index";
import { type MarkdownSubmode, useIOViewerState, type ViewFormat } from "./use-io-viewer-state";

/**
 * How much of a captured value this viewer renders before offering an
 * expander. Exported because the inline editor refuses anything past it: an
 * editor seeded with a truncated value would silently save the truncation.
 */
export const IO_DISPLAY_TRUNCATE_AT = 100_000;
const TRUNCATE_AT = IO_DISPLAY_TRUNCATE_AT;
// Require a meaningful tail before offering an expander — otherwise we
// render "Show remaining 0K chars" on borderline content right at the cap.
const TRUNCATE_TAIL_MIN = 1_000;

const IO_CONTAINER_PADDING = 3;

/**
 * Outer-container chrome for the IOViewer body. Returns whether the body
 * paints flush (no border / radius / bg — the content owns its own chrome)
 * and the inner padding between the border and the content.
 *
 *   - `flush`: only Pretty + chat goes flush — every turn already paints its
 *     own bubble / card, so wrapping them in a redundant "bg.subtle + border"
 *     box just adds a gray frame (operator complaint). Everything else —
 *     plain text, JSON, *and Markdown (rendered or source)* — sits in the
 *     bordered box so the views read consistently side by side.
 *   - `innerPadding`: zero for views that paint edge-to-edge themselves (the
 *     virtualized chat list owns its viewport; the Markdown *source* view is
 *     a `flush` Shiki block whose horizontal scrollbar must hug the outer
 *     border). Rendered Markdown is NOT one of these — it takes the standard
 *     padding so it reads identically to Pretty's plain-text Markdown box.
 *
 * Round 5: rendered Markdown previously went flush, leaving it as bare text
 * floating in the pane while Pretty sat in a tidy bordered box beside it.
 * Both now share the bordered container.
 */
export function ioContainerChrome({
  format,
  isChat,
  markdownSubmode,
  isVirtualizingChat,
}: {
  format: ViewFormat;
  isChat: boolean;
  markdownSubmode: MarkdownSubmode;
  isVirtualizingChat: boolean;
}): { flush: boolean; innerPadding: number } {
  const flush = format === "pretty" && isChat;
  const isFlushMarkdownSource = format === "markdown" && markdownSubmode === "source";
  const innerPadding =
    flush || isFlushMarkdownSource || isVirtualizingChat ? 0 : IO_CONTAINER_PADDING;
  return { flush, innerPadding };
}

interface IOViewerProps {
  label: string;
  content: string;
  /**
   * "input" renders the full chat history (all messages, all roles, tool calls
   * inline). "output" — when the content happens to be a chat-history array —
   * narrows to just the *final assistant message* of that array, since the
   * trace's actual output for this turn is the model's last reply, not the
   * whole transcript. For non-chat content this is a no-op.
   */
  mode?: "input" | "output";
  /**
   * When provided, the panel header offers to comment on this field and, where
   * a suggestion can correct it, to suggest what it should have said. The
   * comment is recorded against the field this viewer is rendering: the span's
   * when the viewer has a span, the trace's own otherwise.
   */
  traceId?: string;
  /**
   * Span this IOViewer is rendering. When set on an `llm` span the header
   * surfaces an "Open in Playground" affordance — the chat history is the
   * natural place to pick the conversation back up, especially for
   * third-party traces with no managed prompt tied to the call.
   */
  spanId?: string;
  /** Span type — `llm` enables the Playground affordance. */
  spanType?: string;
}

export const IOViewer = memo(function IOViewer({
  label,
  content: originalContent,
  mode = "input",
  traceId,
  spanId,
  spanType,
}: IOViewerProps) {
  // Translate-to-English swaps the content feeding the whole viewer
  // pipeline, so every format (pretty/chat/json/markdown) renders the
  // translated variant; Copy follows what's displayed. Chat-shaped
  // payloads are translated per text leaf (message prose and text parts)
  // and re-serialized, so the translated variant still parses and renders
  // as the same conversation — translating the raw transcript JSON as one
  // blob would come back as prose and collapse the chat view to a
  // monospace dump. The translated view renders the conversation itself;
  // envelope keys around it are structure, not language. Each leaf is
  // capped at the display truncation bound so text the viewer never shows
  // is not sent to the model.
  const originalChatMessages = useMemo(
    () => coerceToChatMessages(tryParseJSON(originalContent)),
    [originalContent],
  );
  const chatLeaves = useMemo(() => {
    if (!originalChatMessages) return null;
    const leaves = collectChatTextLeaves(originalChatMessages);
    return Object.keys(leaves).length > 0 ? leaves : null;
  }, [originalChatMessages]);
  const translation = useTextTranslation({
    texts: useMemo(() => {
      const source = chatLeaves ?? { content: originalContent };
      return Object.fromEntries(
        Object.entries(source).map(([key, value]) => [
          key,
          value.slice(0, TRANSLATE_TEXT_MAX_CHARS),
        ]),
      );
    }, [chatLeaves, originalContent]),
  });
  const content = useMemo(() => {
    if (!translation.isActive) return originalContent;
    if (originalChatMessages && chatLeaves) {
      return JSON.stringify(applyChatTextLeaves(originalChatMessages, translation.displayTexts));
    }
    return translation.displayTexts.content ?? originalContent;
  }, [
    translation.isActive,
    translation.displayTexts,
    originalChatMessages,
    chatLeaves,
    originalContent,
  ]);

  // Which part of the trace a comment left on this panel is about: the span's
  // field when the viewer is rendering a span, the trace's own field otherwise.
  const fieldAnchor = useMemo<TraceAnchor | null>(
    () => (traceId ? { anchorKind: "field", anchorId: spanId ?? traceId, anchorPath: mode } : null),
    [traceId, spanId, mode],
  );
  const parsed = useMemo(() => tryParseJSON(content), [content]);
  // Coerce parsed into a chat message array — handles top-level arrays,
  // single message objects, and `{messages: [...]}` / `{input: [...]}`
  // envelopes uniformly. Returns null when the payload genuinely isn't
  // chat-shaped (e.g. a string blob, a flat object).
  const allChatMessages = useMemo(() => coerceToChatMessages(parsed), [parsed]);
  const isChat = allChatMessages !== null;
  const canJson = parsed !== null;

  // Split the chat-shape payload between the two panels:
  //   • Input panel = the full conversation history sent to the model on
  //     this turn — user messages, system / developer prompts, and every
  //     prior assistant operation (thinking, tool_use, tool_result echoes,
  //     intermediate text). Tool_use IDs in input are distinct from those
  //     in output (they belong to earlier LLM calls in the agent loop),
  //     so this is real history, not duplicated output. Trailing
  //     assistant messages still get trimmed because those are this
  //     turn's response and live in the output panel.
  //   • Output panel = everything from the last text-bearing user message
  //     onwards, in full. That keeps the agent's reasoning, tool calls,
  //     tool results, and intermediate assistant turns visible as the
  //     response — which is what they actually are. Earlier behaviour
  //     narrowed this to the final assistant message; that hid the
  //     operation chain.
  const chatMessagesToRender = useMemo<ChatMessage[]>(() => {
    if (!allChatMessages) return [];
    const all = allChatMessages;
    if (mode === "output") {
      let lastUserIdx = -1;
      for (let i = all.length - 1; i >= 0; i--) {
        const msg = all[i]!;
        if (msg.role !== "user") continue;
        const blocks = parseContentBlocks(msg.content);
        const hasText = blocks.some((b) => b.kind === "text");
        if (hasText) {
          lastUserIdx = i;
          break;
        }
      }
      return lastUserIdx >= 0 ? all.slice(lastUserIdx + 1) : all;
    }
    let end = all.length;
    while (end > 0 && all[end - 1]!.role === "assistant") {
      end--;
    }
    return all.slice(0, end);
  }, [allChatMessages, mode]);

  // Group raw messages into logical turns: user prose vs assistant operation
  // chains (which absorb thinking, tool_use, tool_result wrappers from
  // Anthropic's user-role messages).
  const conversationTurns = useMemo<ConversationTurn[]>(
    () => groupMessagesIntoTurns(chatMessagesToRender),
    [chatMessagesToRender],
  );

  const {
    format,
    setFormat,
    chatLayout,
    setChatLayout,
    markdownSubmode,
    setMarkdownSubmode,
    expanded,
    setExpanded,
    collapsed,
    setCollapsed,
    engaged,
    engagedRef,
  } = useIOViewerState({ mode });

  const collapsedSummary =
    isChat && allChatMessages
      ? `${allChatMessages.length} ${allChatMessages.length === 1 ? "message" : "messages"}`
      : `${content.length.toLocaleString()} chars`;

  const isLong = content.length - TRUNCATE_AT > TRUNCATE_TAIL_MIN;
  const displayContent = !isLong || expanded ? content : content.slice(0, TRUNCATE_AT) + "...";
  const prettyJsonContent = useMemo(() => safePrettyJson(displayContent), [displayContent]);

  const markdownBody = useMemo(() => asMarkdownBody(displayContent), [displayContent]);

  // For string-shaped content that isn't a clean chat array, walk the lines
  // and pull out any inline `{"type":"thinking"|"tool_use"|"tool_result"}`
  // JSON blocks so we can render them as cards instead of dumping raw JSON.
  const inlineBlocks = useMemo(
    () => (isChat ? [] : extractInlineBlocks(displayContent)),
    [isChat, displayContent],
  );
  const hasInlineRichContent = useMemo(
    () => inlineBlocks.some((b) => b.kind !== "text" && b.kind !== "raw"),
    [inlineBlocks],
  );

  const formatOptions = useMemo<ViewFormat[]>(
    () => (canJson ? ["pretty", "text", "json", "markdown"] : ["pretty", "text", "markdown"]),
    [canJson],
  );

  // When the virtualized chat list is active it owns its own scroll viewport;
  // the outer card must not impose its own overflow/maxHeight or we'd end up
  // with nested scroll containers.
  const isVirtualizingChat =
    format === "pretty" && isChat && conversationTurns.length >= VIRTUALIZE_AT;
  const { flush: flushOuter, innerPadding } = ioContainerChrome({
    format,
    isChat,
    markdownSubmode,
    isVirtualizingChat,
  });

  // Track whether the preview box's content actually exceeds its visible
  // height. The "Click to interact" scrim only makes sense when there's
  // hidden content to reveal — otherwise it's noise on a one-line input.
  // ResizeObserver catches both initial layout and any reflow (format
  // toggle, density change, font load, etc.). The fallback `scroll` listener
  // covers the case where content height changes without the element
  // resizing (rare, but cheap to add).
  const previewBoxRef = useRef<HTMLDivElement>(null);
  // Value intentionally unread — the effect re-runs measurement on resize/
  // scroll; the overflow flag itself isn't surfaced yet.
  const [, setHasOverflow] = useState(false);
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) {
      setHasOverflow(false);
      return;
    }
    const measure = () => {
      setHasOverflow(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [displayContent, format, isVirtualizingChat, engaged, expanded, chatLayout, markdownSubmode]);

  return (
    <Box>
      <HStack marginBottom={1} gap={2}>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          padding={0}
          minWidth="auto"
          height="auto"
        >
          <Icon as={collapsed ? LuChevronRight : LuChevronDown} boxSize={3} color="fg.muted" />
        </Button>
        <HStack
          gap={2}
          flex={collapsed ? 1 : undefined}
          flexShrink={0}
          cursor="pointer"
          onClick={() => setCollapsed((c) => !c)}
        >
          <Text
            textStyle="2xs"
            fontWeight="bold"
            color="fg"
            letterSpacing="wide"
            textTransform="uppercase"
          >
            {label}
          </Text>
          {collapsed && (
            <Text textStyle="2xs" color="fg.muted">
              {collapsedSummary}
            </Text>
          )}
        </HStack>
        <IOViewerToolbar
          label={label}
          collapsed={collapsed}
          format={format}
          onFormatChange={setFormat}
          formatOptions={formatOptions}
          isChat={isChat}
          chatLayout={chatLayout}
          onChatLayoutChange={setChatLayout}
          markdownSubmode={markdownSubmode}
          onMarkdownSubmodeChange={setMarkdownSubmode}
          translation={translation}
          traceId={traceId}
          spanId={spanId}
          spanType={spanType}
          mode={mode}
          fieldAnchor={fieldAnchor}
          originalContent={originalContent}
          copyText={content}
        />
      </HStack>

      {!collapsed && (
        <>
          <Box ref={engagedRef} position="relative">
            {/* Two-layer structure so the horizontal scrollbar (used by
                wide single-line JSON, code blocks, etc) sits flush
                with the outer rounded border rather than inside the
                padding. The OUTER box owns the border / radius and
                clips horizontally; the INNER box owns the padding so
                content gets breathing room while the scrollbar hugs
                the outer edge. */}
            <Box
              ref={previewBoxRef}
              bg={flushOuter ? "transparent" : "bg.subtle"}
              borderRadius={flushOuter ? "0" : "md"}
              borderWidth={flushOuter ? "0" : "1px"}
              borderColor="border"
              overflowX={flushOuter ? "visible" : "auto"}
              overflowY="visible"
              opacity={1}
              transition="opacity 120ms ease-out"
            >
              <Box padding={innerPadding}>
                {/* A message inside the transcript is a part of the trace a
                    comment can point at, and the transcript components are
                    handed messages rather than the trace they came out of. */}
                <TranscriptRenderProvider
                  renderMediaPart={(part) => <TraceMediaPart part={part} />}
                  renderTerminalOutput={(text, isError) => (
                    <TerminalOutput text={text} isError={isError} />
                  )}
                >
                  <MessageCommentScope traceId={traceId}>
                    <IOViewerBody
                      format={format}
                      isChat={isChat}
                      canJson={canJson}
                      prettyJsonContent={prettyJsonContent}
                      markdownBody={markdownBody}
                      markdownSubmode={markdownSubmode}
                      conversationTurns={conversationTurns}
                      chatLayout={chatLayout}
                      inlineBlocks={inlineBlocks}
                      hasInlineRichContent={hasInlineRichContent}
                      displayContent={displayContent}
                      isLong={isLong}
                      expanded={expanded}
                      mode={mode}
                    />
                  </MessageCommentScope>
                </TranscriptRenderProvider>
              </Box>
            </Box>
            {/*
              The "Click to interact" scrim previously sat here. The new
              drawer pane layout gives every IOViewer its own scroll
              container, so wheel events scope to the pane the cursor is
              over — no opt-in handshake needed.
            */}
          </Box>

          {isLong && (
            <Button
              size="xs"
              variant="plain"
              color="blue.fg"
              padding={0}
              height="auto"
              marginTop={1}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded
                ? "Show less"
                : `Show remaining ${((content.length - TRUNCATE_AT) / 1000).toFixed(0)}K chars`}
            </Button>
          )}
        </>
      )}
    </Box>
  );
});

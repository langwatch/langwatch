import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCopy,
  LuLightbulb,
  LuPencil,
} from "react-icons/lu";
import { useColorMode } from "~/components/ui/color-mode";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { AnnotationPopover } from "./conversationView/AnnotationPopover";
import { safePrettyJson } from "./JsonHighlight";
import { RenderedMarkdown, ShikiCodeBlock } from "./markdownView";
import { SegmentedToggle } from "./SegmentedToggle";
import {
  AssistantTurnCard,
  asMarkdownBody,
  type ChatLayout,
  type ChatMessage,
  type ConversationTurn,
  coerceToChatMessages,
  extractInlineBlocks,
  groupMessagesIntoTurns,
  LONG_THREAD_THRESHOLD,
  parseContentBlocks,
  ThreadedTurnView,
  TurnView,
  tryParseJSON,
  VIRTUALIZE_AT,
  VirtualizedChatList,
} from "./transcript";

const COPY_FEEDBACK_MS = 1500;
const TRUNCATE_AT = 100_000;
// Require a meaningful tail before offering an expander — otherwise we
// render "Show remaining 0K chars" on borderline content right at the cap.
const TRUNCATE_TAIL_MIN = 1_000;
const COMPACT_MAX_HEIGHT_PX = 300;
const EXPANDED_MAX_HEIGHT_PX = 500;

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
   * When provided, the panel header shows Annotate + Suggest-correction
   * actions wired to the annotation comment store. These belong on the
   * trace's input/output specifically (annotations target a trace, not a
   * span), so per-span IOViewers leave this undefined.
   */
  traceId?: string;
}

const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: typeof LuPencil;
    label: string;
  } & React.ComponentProps<typeof Button>
>(function ActionButton({ icon, label, ...buttonProps }, ref) {
  return (
    <Button
      ref={ref}
      size="xs"
      variant="ghost"
      color="fg.muted"
      gap={1.5}
      paddingX={2}
      height="22px"
      onClick={(e) => e.stopPropagation()}
      {...buttonProps}
    >
      <Icon as={icon} boxSize={3} />
      {label}
    </Button>
  );
});

function AnnotateButton({ traceId }: { traceId: string }) {
  const { hasPermission } = useOrganizationTeamProject();
  const [open, setOpen] = useState(false);
  if (!hasPermission("annotations:manage")) return null;
  return (
    <AnnotationPopover
      traceId={traceId}
      mode="annotate"
      open={open}
      onOpenChange={setOpen}
      trigger={<ActionButton icon={LuPencil} label="Annotate" />}
    />
  );
}

function SuggestCorrectionButton({
  traceId,
  output,
}: {
  traceId: string;
  output: string;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  const [open, setOpen] = useState(false);
  if (!hasPermission("annotations:manage")) return null;
  return (
    <AnnotationPopover
      traceId={traceId}
      output={output}
      mode="suggest"
      open={open}
      onOpenChange={setOpen}
      trigger={<ActionButton icon={LuLightbulb} label="Suggest edit" />}
    />
  );
}

type ViewFormat = "pretty" | "text" | "json" | "markdown";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      padding={0}
      minWidth="auto"
      height="auto"
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
    </Button>
  );
}

export function IOViewer({
  label,
  content,
  mode = "input",
  traceId,
}: IOViewerProps) {
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

  const [format, setFormat] = useState<ViewFormat>("pretty");
  // For output mode, default to bubbles — there's only ever one assistant
  // message, so a "Turn N" thread row is meaningless. For input mode (the
  // full chat history), keep thread as the default.
  const [chatLayout, setChatLayout] = useState<ChatLayout>(
    mode === "output" ? "bubbles" : "thread",
  );
  // Markdown sub-mode: rendered (with formatting + Shiki for code fences)
  // or source (raw markdown text, syntax-highlighted as markdown).
  const [markdownSubmode, setMarkdownSubmode] = useState<"rendered" | "source">(
    "rendered",
  );
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { colorMode } = useColorMode();

  // Two-mode interaction: idle = panel is a static preview that lets wheel
  // events pass through to the page. Engaged (after a click) = fully
  // interactive with internal scroll. Clicking anywhere outside the panel
  // disengages it. Combined with `overscroll-behavior: auto` below, the
  // panel never traps scroll either at boundaries or globally.
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engaged) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !engagedRef.current) return;
      if (engagedRef.current.contains(target)) return;
      setEngaged(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [engaged]);

  const collapsedSummary =
    isChat && allChatMessages
      ? `${allChatMessages.length} ${allChatMessages.length === 1 ? "message" : "messages"}`
      : `${content.length.toLocaleString()} chars`;

  const isLong = content.length - TRUNCATE_AT > TRUNCATE_TAIL_MIN;
  const displayContent =
    !isLong || expanded ? content : content.slice(0, TRUNCATE_AT) + "...";
  const prettyJsonContent = useMemo(
    () => safePrettyJson(displayContent),
    [displayContent],
  );

  const markdownBody = useMemo(
    () => asMarkdownBody(displayContent),
    [displayContent],
  );

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
    () =>
      canJson
        ? ["pretty", "text", "json", "markdown"]
        : ["pretty", "text", "markdown"],
    [canJson],
  );

  // When the virtualized chat list is active it owns its own scroll viewport;
  // the outer card must not impose its own overflow/maxHeight or we'd end up
  // with nested scroll containers.
  const isVirtualizingChat =
    format === "pretty" && isChat && conversationTurns.length >= VIRTUALIZE_AT;
  // Output mode + chat = a single AssistantTurnCard. That card already has
  // its own purple-bordered chrome; wrapping it in the IOViewer's outer
  // card makes a card-in-card. Drop the outer chrome there so the
  // assistant card sits flush at the root of the section.
  const flushChatCard = format === "pretty" && isChat && mode === "output";

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
          <Icon
            as={collapsed ? LuChevronRight : LuChevronDown}
            boxSize={3}
            color="fg.muted"
          />
        </Button>
        <HStack
          gap={2}
          flex={1}
          cursor="pointer"
          onClick={() => setCollapsed((c) => !c)}
        >
          <Text
            textStyle="xs"
            fontWeight="semibold"
            color="fg.muted"
            letterSpacing="wide"
            textTransform="uppercase"
          >
            {label}
          </Text>
          {collapsed && (
            <Text textStyle="xs" color="fg.muted">
              {collapsedSummary}
            </Text>
          )}
        </HStack>
        {!collapsed && format === "pretty" && isChat && mode !== "output" && (
          // Output is always a single assistant message — the thread/bubbles
          // distinction is meaningless there, hide the toggle.
          <SegmentedToggle
            value={chatLayout}
            onChange={(l) => setChatLayout(l as ChatLayout)}
            options={["thread", "bubbles"]}
          />
        )}
        {!collapsed && format === "markdown" && (
          <SegmentedToggle
            value={markdownSubmode}
            onChange={(m) => setMarkdownSubmode(m as "rendered" | "source")}
            options={["rendered", "source"]}
          />
        )}
        {!collapsed && (
          <SegmentedToggle
            value={format}
            onChange={(f) => setFormat(f as ViewFormat)}
            options={formatOptions}
          />
        )}
        {!collapsed && traceId && (
          <AnnotateButton traceId={traceId} />
        )}
        {!collapsed && traceId && mode === "output" && (
          <SuggestCorrectionButton traceId={traceId} output={content} />
        )}
        <CopyButton text={content} />
      </HStack>

      {!collapsed && (
        <>
          <Box ref={engagedRef} position="relative">
          <Box
            bg={flushChatCard ? "transparent" : "bg.subtle"}
            borderRadius={flushChatCard ? "0" : "md"}
            borderWidth={flushChatCard ? "0" : "1px"}
            borderColor="border"
            padding={
              flushChatCard
                ? 0
                : format === "markdown" || isVirtualizingChat
                  ? 0
                  : 3
            }
            opacity={!isVirtualizingChat && !engaged ? 0.6 : 1}
            transition="opacity 120ms ease-out"
            maxHeight={
              isVirtualizingChat
                ? undefined
                : engaged
                  ? "min(90vh, 900px)"
                  : "min(80vh, 600px)"
            }
            // Idle: overflow hidden so wheel falls through to the page.
            // Engaged: overflow auto + `overscroll-behavior: auto` so the
            // panel scrolls internally but chains back to the page at
            // boundaries (no trap).
            overflow={
              isVirtualizingChat ? "hidden" : engaged ? "auto" : "hidden"
            }
            overscrollBehavior="auto"
          >
            {format === "json" && canJson ? (
              <ShikiCodeBlock
                code={prettyJsonContent}
                language="json"
                colorMode={colorMode}
                flush
              />
            ) : format === "markdown" ? (
              markdownSubmode === "rendered" ? (
                // Rendered markdown — proper formatting + Shiki for any fenced
                // code blocks inside. Lives behind the toggle because for very
                // long content the rendered path is heavier than source.
                <RenderedMarkdown
                  markdown={markdownBody}
                  paddingX={3}
                  paddingY={2}
                />
              ) : (
                // Source — raw markdown with markdown syntax highlighting.
                // Plain text, copyable, lightning fast even on huge content.
                <ShikiCodeBlock
                  code={markdownBody}
                  language="markdown"
                  colorMode={colorMode}
                  flush
                />
              )
            ) : format === "pretty" && isChat ? (
              conversationTurns.length >= VIRTUALIZE_AT ? (
                <VirtualizedChatList
                  turns={conversationTurns}
                  maxHeightPx={
                    isLong && !expanded
                      ? COMPACT_MAX_HEIGHT_PX
                      : EXPANDED_MAX_HEIGHT_PX
                  }
                  layout={chatLayout}
                  collapseTools={mode === "output"}
                />
              ) : chatLayout === "thread" ? (
                <Box>
                  {conversationTurns.map((turn, i) => {
                    // Default-collapse user turns — they're usually the prompt
                    // we already know we sent. Auto-expand assistant/system
                    // turns and the trailing pair so the response is visible
                    // at a glance without users having to click into every
                    // user bubble in long conversations. Once the convo gets
                    // long, collapse aggressively: only the last turn opens.
                    const isLong =
                      conversationTurns.length > LONG_THREAD_THRESHOLD;
                    const isLastTwo = i >= conversationTurns.length - 2;
                    const defaultExpanded = isLong
                      ? i === conversationTurns.length - 1
                      : turn.kind === "user"
                        ? false
                        : isLastTwo;
                    return (
                      <ThreadedTurnView
                        key={i}
                        turn={turn}
                        index={i}
                        isLast={i === conversationTurns.length - 1}
                        defaultExpanded={defaultExpanded}
                        collapseTools={mode === "output"}
                      />
                    );
                  })}
                </Box>
              ) : (
                <Box>
                  {conversationTurns.map((turn, i) => (
                    <TurnView
                      key={i}
                      turn={turn}
                      collapseTools={mode === "output"}
                    />
                  ))}
                </Box>
              )
            ) : format === "pretty" && hasInlineRichContent ? (
              // Plain-string content with inline typed blocks (e.g. a flattened
              // agent transcript). Render under a single assistant turn card so
              // thinking/tool_use/tool_result get the same visual hierarchy as
              // structured chat — left accent bar, role chip, blocks stacked.
              <AssistantTurnCard
                blocks={inlineBlocks}
                toolCalls={[]}
                collapseTools={mode === "output"}
              />
            ) : format === "pretty" && canJson ? (
              <ShikiCodeBlock
                code={prettyJsonContent}
                language="json"
                colorMode={colorMode}
                flush
              />
            ) : (
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
            )}
          </Box>
          {!isVirtualizingChat && !engaged && (
            <Box
              position="absolute"
              inset={0}
              cursor="zoom-in"
              onClick={() => setEngaged(true)}
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
          )}
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
}

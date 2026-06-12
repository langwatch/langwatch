import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import {
  forwardRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCode,
  LuCopy,
  LuEye,
  LuLightbulb,
  LuList,
  LuMessageSquare,
  LuPencil,
  LuPlay,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { useGoToSpanInPlaygroundTabUrlBuilder } from "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground";
import { AnnotationPopover } from "./conversationView/AnnotationPopover";
import { IOViewerBody } from "./IOViewerBody";
import { safePrettyJson } from "./JsonHighlight";
import { SegmentedToggle } from "./SegmentedToggle";
import {
  asMarkdownBody,
  type ChatLayout,
  type ChatMessage,
  type ConversationTurn,
  coerceToChatMessages,
  extractInlineBlocks,
  groupMessagesIntoTurns,
  parseContentBlocks,
  tryParseJSON,
  VIRTUALIZE_AT,
} from "./transcript";
import { useIOViewerState, type ViewFormat } from "./useIOViewerState";

const COPY_FEEDBACK_MS = 1500;
const TRUNCATE_AT = 100_000;
// Require a meaningful tail before offering an expander — otherwise we
// render "Show remaining 0K chars" on borderline content right at the cap.
const TRUNCATE_TAIL_MIN = 1_000;

interface IOViewerProps {
  label: string;
  content: string;
  /**
   * Rendered inside the content box, directly under the body — used by the
   * visibility-window gate so blurred filler reads as a continuation of the
   * real text rather than a separate block (ADR-028 §7).
   */
  afterBody?: ReactNode;
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

function PlaygroundButton({ spanId }: { spanId: string }) {
  const { buildUrl } = useGoToSpanInPlaygroundTabUrlBuilder();
  // No explicit action — the playground loader auto-detects: opens the
  // existing managed prompt at the traced version when one is linked,
  // creates a fresh tab when not. One button, smart default.
  const href = buildUrl(spanId)?.toString() ?? "";
  if (!href) return null;
  return (
    <Button
      asChild
      size="xs"
      variant="ghost"
      color="fg.muted"
      gap={1.5}
      paddingX={2}
      height="22px"
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon as={LuPlay} boxSize={3} />
        Open in Playground
      </a>
    </Button>
  );
}

function AnnotateButton({ traceId }: { traceId: string }) {
  const { hasPermission } = useOrganizationTeamProject();
  const [open, setOpen] = useState(false);
  const annotationsGate = usePersonalFeatureGate("annotations");
  if (!hasPermission("annotations:manage")) return null;
  return (
    <>
      <AnnotationPopover
        traceId={traceId}
        mode="annotate"
        open={open}
        onOpenChange={async (next) => {
          if (next) {
            const allowed = await annotationsGate.requestEnable();
            if (!allowed) return;
          }
          setOpen(next);
        }}
        trigger={<ActionButton icon={LuPencil} label="Annotate" />}
      />
      <PersonalFeatureGateDialog state={annotationsGate.dialogState} />
    </>
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

export const IOViewer = memo(function IOViewer({
  label,
  content,
  afterBody,
  mode = "input",
  traceId,
  spanId,
  spanType,
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
    setEngaged,
    engagedRef,
  } = useIOViewerState({ mode });

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
  // Pretty + chat: every individual turn already paints its own role
  // chrome (bubble, card, or thread row with an avatar header). The
  // outer IOViewer "bg.subtle + border" box around them just looks
  // like a redundant container — operator complaint: "remove this
  // gray box around the input, why does it exist?". Applies whether
  // we're rendering the input history or the output reply.
  const flushChatCard = format === "pretty" && isChat;
  // Rendered markdown paints its own typography (headings, paragraphs,
  // fenced code blocks, etc.) — the outer "bg.subtle + border" container
  // makes the whole thing read as one giant code block, with the real
  // fenced code blocks nested inside a near-identical box. Drop the
  // outer chrome so prose looks like prose and code looks like code.
  // Source mode (raw markdown text) keeps the box since it IS just text.
  const flushMarkdown = format === "markdown" && markdownSubmode === "rendered";
  const flushOuter = flushChatCard || flushMarkdown;

  // Track whether the preview box's content actually exceeds its visible
  // height. The "Click to interact" scrim only makes sense when there's
  // hidden content to reveal — otherwise it's noise on a one-line input.
  // ResizeObserver catches both initial layout and any reflow (format
  // toggle, density change, font load, etc.). The fallback `scroll` listener
  // covers the case where content height changes without the element
  // resizing (rare, but cheap to add).
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
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
  }, [
    displayContent,
    format,
    isVirtualizingChat,
    engaged,
    expanded,
    chatLayout,
    markdownSubmode,
  ]);

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
        {!collapsed && (
          <SegmentedToggle
            value={format}
            onChange={(f) => setFormat(f as ViewFormat)}
            options={formatOptions.map((opt) => {
              // Both layouts (thread / bubbles) are available for any
              // chat-shaped content — input *or* output. Even with a
              // single assistant reply, the operator may want the
              // bubble visual; conversely, a multi-message output
              // (rare but possible) benefits from the flat stack.
              if (opt === "pretty" && isChat) {
                return {
                  value: "pretty",
                  submodes: {
                    value: chatLayout,
                    onChange: (v) => setChatLayout(v as ChatLayout),
                    options: [
                      {
                        value: "thread",
                        label: "Thread",
                        icon: LuList,
                        tooltip: "Thread layout",
                      },
                      {
                        value: "bubbles",
                        label: "Bubbles",
                        icon: LuMessageSquare,
                        tooltip: "Bubble layout",
                      },
                    ],
                  },
                };
              }
              if (opt === "markdown") {
                return {
                  value: "markdown",
                  submodes: {
                    value: markdownSubmode,
                    onChange: (v) =>
                      setMarkdownSubmode(v as "rendered" | "source"),
                    options: [
                      {
                        value: "rendered",
                        label: "Rendered",
                        icon: LuEye,
                        tooltip: "Rendered markdown view",
                      },
                      {
                        value: "source",
                        label: "Source",
                        icon: LuCode,
                        tooltip: "Source markdown view",
                      },
                    ],
                  },
                };
              }
              return opt;
            })}
          />
        )}
        {!collapsed && traceId && <AnnotateButton traceId={traceId} />}
        {!collapsed && traceId && mode === "output" && (
          <SuggestCorrectionButton traceId={traceId} output={content} />
        )}
        {!collapsed && spanType === "llm" && spanId && mode === "input" && (
          <PlaygroundButton spanId={spanId} />
        )}
        <CopyButton text={content} />
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
              <Box
                padding={
                  flushOuter
                    ? 0
                    : format === "markdown" || isVirtualizingChat
                      ? 0
                      : 3
                }
              >
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
                {afterBody}
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

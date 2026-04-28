import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Database,
  Edit3,
  Lightbulb,
  MoreHorizontal,
  Settings2,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useAnnotationCommentStore } from "~/hooks/useAnnotationCommentStore";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import type { TraceListItem } from "../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "../../utils/formatters";
import { Bubble } from "../TraceTable/registry/addons/conversation/Bubble";
import { RenderedMarkdown } from "./MarkdownView";
import {
  getDisplayRoleVisuals,
  useIsScenarioRole,
} from "./scenarioRoles";
import { SegmentedToggle } from "./SegmentedToggle";
import { extractReadableText, extractReasoningText, ReasoningBlock } from "./Transcript";

interface ConversationViewProps {
  conversationId: string;
  currentTraceId: string;
}

type Mode = "bubbles" | "markdown";

interface ParsedTurn {
  turn: TraceListItem;
  userText: string;
  /**
   * Pre-extracted assistant prose for the bubble. Strips Anthropic-style
   * `{role:"assistant",content:[{type:"thinking"…},…]}` envelopes and
   * pulls just the text blocks, so we don't dump raw JSON in the bubble.
   */
  assistantText: string;
  assistantReasoning: string;
  gapSecs: number;
  showGap: boolean;
}

const EMPTY_TURNS: TraceListItem[] = [];

export function ConversationView({
  conversationId,
  currentTraceId,
}: ConversationViewProps) {
  const { project } = useOrganizationTeamProject();
  const { navigateToTrace } = useTraceDrawerNavigation();
  const [mode, setMode] = useState<Mode>("bubbles");

  // Stable time range. Inlining `Date.now()` here would re-derive the bounds
  // every render → the query key would churn → React Query would refetch
  // forever and the UI would never settle. Pin the window per (project,
  // conversation).
  const timeRange = useMemo(
    () => {
      const now = Date.now();
      return { from: now - 365 * 24 * 60 * 60 * 1000, to: now };
    },
    [project?.id, conversationId],
  );

  const query = api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange,
      sort: { columnId: "time", direction: "asc" },
      page: 1,
      pageSize: 100,
      query: `conversation:"${conversationId.replace(/"/g, '\\"')}"`,
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
      // Keep the previous turn list visible during background refetches
      // instead of flashing the loading skeleton.
      keepPreviousData: true,
    },
  );

  const turns =
    (query.data?.items as TraceListItem[] | undefined) ?? EMPTY_TURNS;

  // Single pass over `turns`: pre-parse the latest user message and the
  // wall-clock gap to the previous turn. Without this, every ChatTurnRow
  // re-render would re-JSON.parse the entire input payload on its own.
  const parsedTurns = useMemo<ParsedTurn[]>(() => {
    const out: ParsedTurn[] = new Array(turns.length);
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!;
      const prev = i > 0 ? turns[i - 1]! : undefined;
      const gapSecs = prev
        ? (t.timestamp - (prev.timestamp + prev.durationMs)) / 1000
        : 0;
      out[i] = {
        turn: t,
        // Use the shared Transcript helper so we handle the same shapes
        // the I/O viewer does (chat arrays, single message objects,
        // typed-block content arrays). parseLastUserText only handled
        // chat arrays, missing single-message and bare-block envelopes.
        userText: extractReadableText(t.input, "user") || parseLastUserText(t.input),
        assistantText: extractReadableText(t.output, "assistant"),
        assistantReasoning: extractReasoningText(t.output),
        gapSecs,
        showGap: gapSecs > 5,
      };
    }
    return out;
  }, [turns]);

  // Stable select callback. Closes over a ref instead of `currentTraceId` so
  // its identity doesn't change every time the user navigates to a different
  // turn — otherwise every row's memo would bail on each navigation even
  // though only the previously- and newly-selected rows actually change.
  const currentTraceIdRef = useRef(currentTraceId);
  useEffect(() => {
    currentTraceIdRef.current = currentTraceId;
  }, [currentTraceId]);
  const handleSelectTurn = useCallback(
    (traceId: string) => {
      navigateToTrace({
        fromTraceId: currentTraceIdRef.current,
        fromViewMode: "conversation",
        toTraceId: traceId,
        toViewMode: "trace",
      });
    },
    [navigateToTrace],
  );

  // Build markdown at the parent so the result survives mode toggles. Stay
  // lazy: skip the build until the user has actually viewed markdown at least
  // once, so first render in bubbles mode pays nothing.
  const [hasViewedMarkdown, setHasViewedMarkdown] = useState(
    () => mode === "markdown",
  );
  useEffect(() => {
    if (mode === "markdown") setHasViewedMarkdown(true);
  }, [mode]);
  const markdown = useMemo(() => {
    if (!hasViewedMarkdown) return "";
    return buildConversationMarkdown(conversationId, parsedTurns);
  }, [hasViewedMarkdown, conversationId, parsedTurns]);

  // Only show the skeleton on the very first load. With keepPreviousData
  // the previous conversation's turns stay rendered while the new query
  // fetches in the background, so re-clicking a cached conversation no
  // longer flashes the skeleton.
  if (query.isLoading && !query.data) {
    return <ConversationSkeleton conversationId={conversationId} />;
  }

  if (turns.length === 0) {
    return (
      <Flex align="center" justify="center" padding={6}>
        <Text textStyle="xs" color="fg.subtle">
          No turns found in this conversation
        </Text>
      </Flex>
    );
  }

  return (
    <VStack align="stretch" gap={0} height="full">
      <ConversationHeader
        conversationId={conversationId}
        turnCount={turns.length}
        mode={mode}
        onModeChange={setMode}
      />
      {mode === "bubbles" ? (
        <BubblesView
          parsedTurns={parsedTurns}
          systemPromptInput={turns[0]?.input}
          currentTraceId={currentTraceId}
          onSelectTurn={handleSelectTurn}
        />
      ) : (
        <MarkdownConversationView markdown={markdown} />
      )}
    </VStack>
  );
}

const SKELETON_TURNS: { user: string; assistant: [string, string?] }[] = [
  { user: "62%", assistant: ["88%", "54%"] },
  { user: "44%", assistant: ["76%"] },
  { user: "70%", assistant: ["92%", "68%"] },
];

const ConversationSkeleton: React.FC<{ conversationId: string }> = ({
  conversationId,
}) => {
  return (
    <VStack
      align="stretch"
      gap={0}
      height="full"
      aria-busy="true"
      aria-label="Loading conversation"
    >
      <HStack
        gap={2}
        paddingX={4}
        paddingY={2.5}
        borderBottomWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
        flexShrink={0}
      >
        <Text
          textStyle="2xs"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
          fontWeight="semibold"
        >
          Conversation
        </Text>
        <Text textStyle="xs" color="fg.subtle" fontFamily="mono" truncate>
          {conversationId}
        </Text>
        <Box flex={1} />
        <Skeleton height="10px" width="40px" borderRadius="sm" />
        <Skeleton height="20px" width="96px" borderRadius="md" />
      </HStack>

      <VStack align="stretch" gap={5} paddingX={5} paddingY={4} overflow="hidden">
        {SKELETON_TURNS.map((turn, i) => (
          <VStack key={i} align="stretch" gap={2}>
            <Flex align="center" gap={2}>
              <Skeleton height="14px" width="20px" borderRadius="sm" />
              <Box height="1px" flex={1} bg="border.muted" />
              <Skeleton height="10px" width="48px" borderRadius="sm" />
            </Flex>

            <HStack align="flex-start" gap={2}>
              <Skeleton boxSize="22px" borderRadius="full" flexShrink={0} />
              <VStack
                align="stretch"
                gap={1}
                flex={1}
                maxWidth="78%"
                borderRadius="lg"
                borderTopLeftRadius="sm"
                borderWidth="1px"
                borderColor="border.muted"
                bg="bg.subtle"
                paddingX={3}
                paddingY={2}
              >
                <Skeleton height="9px" width="32px" borderRadius="sm" />
                <Skeleton height="11px" width={turn.user} borderRadius="sm" />
              </VStack>
            </HStack>

            <HStack align="flex-start" gap={2} justify="flex-end">
              <VStack
                align="stretch"
                gap={1}
                flex={1}
                maxWidth="78%"
                borderRadius="lg"
                borderTopRightRadius="sm"
                borderWidth="1px"
                borderColor="border.muted"
                bg="bg.panel"
                paddingX={3}
                paddingY={2}
              >
                <Skeleton height="9px" width="56px" borderRadius="sm" />
                <Skeleton height="11px" width={turn.assistant[0]} borderRadius="sm" />
                {turn.assistant[1] && (
                  <Skeleton height="11px" width={turn.assistant[1]} borderRadius="sm" />
                )}
              </VStack>
              <Skeleton boxSize="22px" borderRadius="full" flexShrink={0} />
            </HStack>
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
};

const ConversationHeader: React.FC<{
  conversationId: string;
  turnCount: number;
  mode: Mode;
  onModeChange: (m: Mode) => void;
}> = ({ conversationId, turnCount, mode, onModeChange }) => (
  <HStack
    gap={2}
    paddingX={4}
    paddingY={2.5}
    borderBottomWidth="1px"
    borderColor="border.muted"
    bg="bg.subtle"
    flexShrink={0}
  >
    <Text
      textStyle="2xs"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="0.06em"
      fontWeight="semibold"
    >
      Conversation
    </Text>
    <Text textStyle="xs" color="fg.subtle" fontFamily="mono" truncate>
      {conversationId}
    </Text>
    <Box flex={1} />
    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
      {turnCount} turn{turnCount === 1 ? "" : "s"}
    </Text>
    <SegmentedToggle
      value={mode}
      onChange={(v) => onModeChange(v as Mode)}
      options={["bubbles", "markdown"]}
    />
  </HStack>
);

const BubblesView: React.FC<{
  parsedTurns: ParsedTurn[];
  systemPromptInput: string | null | undefined;
  currentTraceId: string;
  onSelectTurn: (traceId: string) => void;
}> = ({ parsedTurns, systemPromptInput, currentTraceId, onSelectTurn }) => {
  const systemPrompt = useMemo(
    () => parseSystemPrompt(systemPromptInput),
    [systemPromptInput],
  );

  return (
    <VStack align="stretch" gap={5} paddingX={5} paddingY={4} overflow="auto">
      {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
      {parsedTurns.map((p, i) => (
        <ChatTurnRow
          key={p.turn.traceId}
          turn={p.turn}
          userText={p.userText}
          assistantText={p.assistantText}
          assistantReasoning={p.assistantReasoning}
          gapSecs={p.gapSecs}
          showGap={p.showGap}
          index={i + 1}
          isCurrent={p.turn.traceId === currentTraceId}
          onSelect={onSelectTurn}
        />
      ))}
    </VStack>
  );
};

const SystemPromptBanner: React.FC<{ text: string }> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 280;
  return (
    <Box
      borderRadius="lg"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      overflow="hidden"
    >
      <HStack
        gap={2}
        paddingX={3}
        paddingY={2}
        cursor={isLong ? "pointer" : "default"}
        onClick={isLong ? () => setExpanded((v) => !v) : undefined}
        _hover={isLong ? { bg: "bg.muted" } : undefined}
      >
        <Icon as={Settings2} boxSize="13px" color="fg.muted" />
        <Text
          textStyle="2xs"
          fontWeight="600"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          System
        </Text>
        <Box flex={1} />
        {isLong && (
          <Icon
            as={expanded ? ChevronDown : ChevronRight}
            boxSize="13px"
            color="fg.subtle"
          />
        )}
      </HStack>
      <Box
        paddingX={3}
        paddingBottom={2.5}
        paddingTop={0.5}
        borderTopWidth="1px"
        borderTopColor="border.muted"
      >
        <Text
          textStyle="xs"
          fontFamily="mono"
          color="fg.muted"
          whiteSpace="pre-wrap"
          lineHeight="1.6"
          lineClamp={isLong && !expanded ? 3 : undefined}
        >
          {text}
        </Text>
      </Box>
    </Box>
  );
};

interface ChatTurnRowProps {
  turn: TraceListItem;
  userText: string;
  assistantText: string;
  assistantReasoning: string;
  gapSecs: number;
  showGap: boolean;
  index: number;
  isCurrent: boolean;
  onSelect: (traceId: string) => void;
}

const ChatTurnRow = memo<ChatTurnRowProps>(function ChatTurnRow({
  turn,
  userText,
  assistantText,
  assistantReasoning,
  gapSecs,
  showGap,
  index,
  isCurrent,
  onSelect,
}) {
  const handleSelect = useCallback(
    () => onSelect(turn.traceId),
    [onSelect, turn.traceId],
  );

  // Scenario-aware visual mapping. The text fields stay role-faithful
  // (`userText` is whatever the source `user` message said), but the
  // bubble's side / tone / label / icon flip in scenario mode so the
  // agent under test reads as the trace's "user" and the simulator
  // reads as the "assistant".
  const isScenario = useIsScenarioRole();
  const userVisuals = getDisplayRoleVisuals("user", { isScenario });
  const assistantVisuals = getDisplayRoleVisuals("assistant", { isScenario });
  const userSide = userVisuals.displayRole === "user" ? "left" : "right";
  const assistantSide =
    assistantVisuals.displayRole === "user" ? "left" : "right";
  const UserIcon = userVisuals.Icon;
  const AssistantIcon = assistantVisuals.Icon;
  // Model abbreviation belongs with the agent's response — i.e. whichever
  // bubble carries `assistantText`. The fallback comes from the helper so
  // it reads "Assistant" normally and "Agent" in scenario mode.
  const assistantLabel = turn.models[0]
    ? abbreviateModel(turn.models[0])
    : assistantVisuals.bubbleLabel;

  return (
    <VStack align="stretch" gap={2}>
      {showGap && (
        <Flex align="center" gap={2}>
          <Box height="1px" flex={1} bg="border.muted" />
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            {formatGap(gapSecs)}
          </Text>
          <Box height="1px" flex={1} bg="border.muted" />
        </Flex>
      )}

      <TurnSeparator
        index={index}
        turn={turn}
        isCurrent={isCurrent}
        onSelect={handleSelect}
      />

      {userText && (
        <Bubble
          side={userSide}
          tone={userVisuals.displayRole}
          label={userVisuals.bubbleLabel}
          icon={<UserIcon />}
          text={userText}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      )}

      {assistantText ? (
        <Bubble
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text={assistantText}
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      ) : turn.error ? (
        <Bubble
          side={assistantSide}
          tone="error"
          label="Error"
          icon={<AlertTriangle />}
          text={turn.error}
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      ) : assistantReasoning ? (
        <Bubble
          side={assistantSide}
          tone={assistantVisuals.displayRole}
          label={assistantLabel}
          icon={<AssistantIcon />}
          text=""
          reasoning={assistantReasoning}
          isSelected={isCurrent}
          onClick={handleSelect}
          size="compact"
          maxChars={500}
        />
      ) : null}
    </VStack>
  );
});

const TurnActionsMenu: React.FC<{ turn: TraceListItem }> = ({ turn }) => {
  const setCommentState = useAnnotationCommentStore((s) => s.setCommentState);
  const { openDrawer } = useDrawer();

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const handleAnnotate = useCallback(() => {
    setCommentState({
      traceId: turn.traceId,
      action: "new",
      annotationId: undefined,
    });
  }, [setCommentState, turn.traceId]);

  const handleSuggest = useCallback(() => {
    setCommentState({
      traceId: turn.traceId,
      action: "new",
      annotationId: undefined,
      expectedOutput: turn.output ?? "",
      expectedOutputAction: "new",
    });
  }, [setCommentState, turn.traceId, turn.output]);

  const handleAddToDataset = useCallback(() => {
    openDrawer("addDatasetRecord", { traceId: turn.traceId });
  }, [openDrawer, turn.traceId]);

  return (
    <Menu.Root>
      <Tooltip
        content="Turn actions"
        positioning={{ placement: "top" }}
      >
        <Menu.Trigger asChild>
          <Button
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            paddingX={1}
            minWidth="auto"
            onClick={stop}
            aria-label="Turn actions"
          >
            <Icon as={MoreHorizontal} boxSize={3} />
          </Button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content minWidth="160px" onClick={stop}>
        <Menu.Item value="annotate" onClick={handleAnnotate}>
          <Icon as={Edit3} boxSize={3.5} />
          Annotate
        </Menu.Item>
        <Menu.Item value="suggest" onClick={handleSuggest}>
          <Icon as={Lightbulb} boxSize={3.5} />
          Suggest correction
        </Menu.Item>
        <Menu.Item value="add-to-dataset" onClick={handleAddToDataset}>
          <Icon as={Database} boxSize={3.5} />
          Add to Dataset
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
};

const TurnSeparator: React.FC<{
  index: number;
  turn: TraceListItem;
  isCurrent: boolean;
  onSelect: () => void;
}> = ({ index, turn, isCurrent, onSelect }) => {
  // Pick the bits worth showing per turn — model, duration, latency, token
  // load, cost, error state — so the separator reads as a per-turn ledger
  // rather than just "Turn N · Xs". Skips fields that don't apply (no cost
  // → no `$0` chip; ok status → no error chip) to stay scannable.
  const model = turn.models[0] ? abbreviateModel(turn.models[0]) : null;
  const hasCost = (turn.totalCost ?? 0) > 0;
  const hasTokens = turn.totalTokens > 0;
  const isError = turn.status === "error";

  const Sep = () => (
    <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
      ·
    </Text>
  );

  return (
    <Flex
      align="center"
      gap={2}
      cursor="pointer"
      onClick={onSelect}
      role="group"
      _hover={{ "& > .turn-line": { bg: "border.emphasized" } }}
    >
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={isCurrent ? "blue.solid" : "border.muted"}
        transition="background 0.12s ease"
      />
      <HStack gap={1.5} flexShrink={0} flexWrap="wrap" justify="center">
        <Text
          textStyle="2xs"
          color={isCurrent ? "blue.fg" : "fg.subtle"}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          Turn {index}
        </Text>
        {model && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
              {model}
            </Text>
          </>
        )}
        <Sep />
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {formatDuration(turn.durationMs)}
        </Text>
        {turn.ttft != null && turn.ttft > 0 && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
              ttft {formatDuration(turn.ttft)}
            </Text>
          </>
        )}
        {hasTokens && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
              {turn.inputTokens != null && turn.outputTokens != null
                ? `${formatTokens(turn.inputTokens)}→${formatTokens(turn.outputTokens)}`
                : `${formatTokens(turn.totalTokens)} tok`}
              {turn.tokensEstimated ? "*" : ""}
            </Text>
          </>
        )}
        {hasCost && (
          <>
            <Sep />
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
              {formatCost(turn.totalCost)}
            </Text>
          </>
        )}
        <Sep />
        <Text textStyle="2xs" color="fg.subtle">
          {formatRelativeTime(turn.timestamp)}
        </Text>
        {isError && (
          <>
            <Sep />
            <Text
              textStyle="2xs"
              color="red.fg"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing="0.06em"
            >
              error
            </Text>
          </>
        )}
      </HStack>
      <Box
        className="turn-line"
        height="1px"
        flex={1}
        bg={isCurrent ? "blue.solid" : "border.muted"}
        transition="background 0.12s ease"
      />
      <TurnActionsMenu turn={turn} />
    </Flex>
  );
};

const MarkdownConversationView: React.FC<{ markdown: string }> = ({
  markdown,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [markdown]);

  return (
    <VStack align="stretch" gap={0} flex={1} minHeight={0}>
      <HStack
        paddingX={4}
        paddingY={2}
        gap={2}
        borderBottomWidth="1px"
        borderColor="border.muted"
        bg="bg.panel"
        flexShrink={0}
      >
        <Text textStyle="xs" color="fg.muted">
          Rendered for reading — Copy gives you the raw markdown source.
        </Text>
        <Box flex={1} />
        <Button
          size="xs"
          variant="outline"
          colorPalette="blue"
          onClick={handleCopy}
        >
          <Icon as={copied ? Check : Copy} boxSize="12px" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
      <Box flex={1} overflow="auto" bg="bg.panel">
        <RenderedMarkdown markdown={markdown} paddingX={4} paddingY={3} />
      </Box>
    </VStack>
  );
};

function buildConversationMarkdown(
  conversationId: string,
  parsedTurns: ParsedTurn[],
): string {
  const lines: string[] = [];
  lines.push(`# Conversation \`${conversationId}\``);
  lines.push("");
  const systemPrompt = parseSystemPrompt(parsedTurns[0]?.turn.input);
  if (systemPrompt) {
    lines.push("## System");
    lines.push("");
    lines.push("```");
    lines.push(systemPrompt);
    lines.push("```");
    lines.push("");
  }
  lines.push(`- **Turns:** ${parsedTurns.length}`);
  if (parsedTurns.length > 0) {
    const first = parsedTurns[0]!.turn;
    const last = parsedTurns[parsedTurns.length - 1]!.turn;
    lines.push(`- **Started:** ${new Date(first.timestamp).toISOString()}`);
    lines.push(`- **Last turn:** ${new Date(last.timestamp).toISOString()}`);
    let totalCost = 0;
    let totalTokens = 0;
    for (const p of parsedTurns) {
      totalCost += p.turn.totalCost ?? 0;
      totalTokens += p.turn.totalTokens;
    }
    if (totalCost > 0) lines.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
    if (totalTokens > 0) lines.push(`- **Total tokens:** ${totalTokens}`);
  }
  lines.push("");

  for (let i = 0; i < parsedTurns.length; i++) {
    const { turn, userText } = parsedTurns[i]!;
    const model = turn.models[0] ? abbreviateModel(turn.models[0]) : "—";
    lines.push(
      `## Turn ${i + 1} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    );
    lines.push("");

    if (userText) {
      lines.push("**User:**");
      lines.push("");
      lines.push(userText);
      lines.push("");
    }

    if (turn.output) {
      lines.push("**Assistant:**");
      lines.push("");
      lines.push(turn.output);
      lines.push("");
    } else if (turn.error) {
      lines.push("**Error:**");
      lines.push("");
      lines.push("```");
      lines.push(turn.error);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Extract the first system message from the chat-history input. Used to render
 * the conversation-level system prompt banner. Returns "" if not chat-shaped or
 * no system role present.
 */
function parseSystemPrompt(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const sys = parsed.find(
        (m) => m && typeof m === "object" && m.role === "system",
      );
      if (sys) return contentToString(sys.content);
    }
  } catch {
    // not JSON
  }
  return "";
}

/**
 * The `input` field on a trace is often the full chat history (system + earlier
 * turns + the latest user message). For chat rendering we want just the latest
 * user message — that's the new content this turn.
 */
function parseLastUserText(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const lastUser = [...parsed]
        .reverse()
        .find((m) => m && typeof m === "object" && m.role === "user");
      if (lastUser) return contentToString(lastUser.content);
    }
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON
  }
  return raw;
}

function contentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content);
}

function formatGap(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s gap`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}m ${s}s gap`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m gap`;
}

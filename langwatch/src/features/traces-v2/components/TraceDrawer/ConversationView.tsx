import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Settings2,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import type { TraceListItem } from "../../types/trace";
import {
  abbreviateModel,
  formatDuration,
  formatRelativeTime,
} from "../../utils/formatters";
import { Bubble } from "../TraceTable/registry/addons/conversation/Bubble";
import { SegmentedToggle } from "./SegmentedToggle";

interface ConversationViewProps {
  conversationId: string;
  currentTraceId: string;
}

type Mode = "bubbles" | "markdown";

export function ConversationView({
  conversationId,
  currentTraceId,
}: ConversationViewProps) {
  const { project } = useOrganizationTeamProject();
  const { navigateToTrace } = useTraceDrawerNavigation();
  const [mode, setMode] = useState<Mode>("bubbles");

  const query = api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: {
        from: Date.now() - 365 * 24 * 60 * 60 * 1000,
        to: Date.now(),
      },
      sort: { columnId: "time", direction: "asc" },
      page: 1,
      pageSize: 100,
      query: `conversation:"${conversationId.replace(/"/g, '\\"')}"`,
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
    },
  );

  const turns = useMemo<TraceListItem[]>(
    () => (query.data?.items as TraceListItem[]) ?? [],
    [query.data],
  );

  const handleSelectTurn = (traceId: string) => {
    navigateToTrace({
      fromTraceId: currentTraceId,
      fromViewMode: "conversation",
      toTraceId: traceId,
      toViewMode: "trace",
    });
  };

  if (query.isLoading) {
    return (
      <VStack align="stretch" gap={2} padding={4}>
        {[1, 2, 3].map((i) => (
          <Box
            key={i}
            height="56px"
            borderRadius="md"
            bg="bg.muted"
            css={{
              animation: `convoPulse 1.4s ease-in-out ${i * 0.1}s infinite`,
              "@keyframes convoPulse": {
                "0%, 100%": { opacity: 0.55 },
                "50%": { opacity: 0.85 },
              },
            }}
          />
        ))}
      </VStack>
    );
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
          turns={turns}
          currentTraceId={currentTraceId}
          onSelectTurn={handleSelectTurn}
        />
      ) : (
        <MarkdownConversationView
          turns={turns}
          conversationId={conversationId}
        />
      )}
    </VStack>
  );
}

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
  turns: TraceListItem[];
  currentTraceId: string;
  onSelectTurn: (traceId: string) => void;
}> = ({ turns, currentTraceId, onSelectTurn }) => {
  const systemPrompt = useMemo(
    () => parseSystemPrompt(turns[0]?.input),
    [turns],
  );

  return (
    <VStack align="stretch" gap={5} paddingX={5} paddingY={4} overflow="auto">
      {systemPrompt && <SystemPromptBanner text={systemPrompt} />}
      {turns.map((turn, i) => (
        <ChatTurnRow
          key={turn.traceId}
          turn={turn}
          index={i + 1}
          prev={i > 0 ? turns[i - 1] : undefined}
          isCurrent={turn.traceId === currentTraceId}
          onSelect={() => onSelectTurn(turn.traceId)}
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

const ChatTurnRow: React.FC<{
  turn: TraceListItem;
  index: number;
  prev?: TraceListItem;
  isCurrent: boolean;
  onSelect: () => void;
}> = ({ turn, index, prev, isCurrent, onSelect }) => {
  const gapSecs = prev
    ? (turn.timestamp - (prev.timestamp + prev.durationMs)) / 1000
    : 0;
  const showGap = gapSecs > 5;
  const turnInput = parseLastUserText(turn.input);
  const turnOutput = turn.output;

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
        onSelect={onSelect}
      />

      {turnInput && (
        <Bubble
          side="left"
          tone="user"
          label="User"
          icon={<User />}
          text={turnInput}
          isSelected={isCurrent}
          onClick={onSelect}
          size="compact"
          maxChars={500}
        />
      )}

      {turnOutput ? (
        <Bubble
          side="right"
          tone="assistant"
          label={turn.models[0] ? abbreviateModel(turn.models[0]) : "Assistant"}
          icon={<Bot />}
          text={turnOutput}
          isSelected={isCurrent}
          onClick={onSelect}
          size="compact"
          maxChars={500}
        />
      ) : turn.error ? (
        <Bubble
          side="right"
          tone="error"
          label="Error"
          icon={<AlertTriangle />}
          text={turn.error}
          isSelected={isCurrent}
          onClick={onSelect}
          size="compact"
          maxChars={500}
        />
      ) : null}
    </VStack>
  );
};

const TurnSeparator: React.FC<{
  index: number;
  turn: TraceListItem;
  isCurrent: boolean;
  onSelect: () => void;
}> = ({ index, turn, isCurrent, onSelect }) => (
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
    <HStack gap={1.5} flexShrink={0}>
      <Text
        textStyle="2xs"
        color={isCurrent ? "blue.fg" : "fg.subtle"}
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        Turn {index}
      </Text>
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
        ·
      </Text>
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
        {formatDuration(turn.durationMs)}
      </Text>
      <Text textStyle="2xs" color="fg.subtle">
        ·
      </Text>
      <Text textStyle="2xs" color="fg.subtle">
        {formatRelativeTime(turn.timestamp)}
      </Text>
    </HStack>
    <Box
      className="turn-line"
      height="1px"
      flex={1}
      bg={isCurrent ? "blue.solid" : "border.muted"}
      transition="background 0.12s ease"
    />
  </Flex>
);

const MarkdownConversationView: React.FC<{
  turns: TraceListItem[];
  conversationId: string;
}> = ({ turns, conversationId }) => {
  const markdown = useMemo(
    () => buildConversationMarkdown(conversationId, turns),
    [conversationId, turns],
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
          Plain markdown — paste into any LLM or doc.
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
      <Box flex={1} overflow="auto" padding={4} bg="bg.subtle">
        <Textarea
          value={markdown}
          readOnly
          fontFamily="mono"
          fontSize="xs"
          lineHeight="1.6"
          minHeight="100%"
          resize="none"
          border="none"
          background="transparent"
          padding={0}
          _focus={{ boxShadow: "none", outline: "none" }}
          spellCheck={false}
        />
      </Box>
    </VStack>
  );
};

function buildConversationMarkdown(
  conversationId: string,
  turns: TraceListItem[],
): string {
  const lines: string[] = [];
  lines.push(`# Conversation \`${conversationId}\``);
  lines.push("");
  const systemPrompt = parseSystemPrompt(turns[0]?.input);
  if (systemPrompt) {
    lines.push("## System");
    lines.push("");
    lines.push("```");
    lines.push(systemPrompt);
    lines.push("```");
    lines.push("");
  }
  lines.push(`- **Turns:** ${turns.length}`);
  if (turns.length > 0) {
    const first = turns[0]!;
    const last = turns[turns.length - 1]!;
    lines.push(
      `- **Started:** ${new Date(first.timestamp).toISOString()}`,
    );
    lines.push(
      `- **Last turn:** ${new Date(last.timestamp).toISOString()}`,
    );
    const totalCost = turns.reduce((s, t) => s + (t.totalCost ?? 0), 0);
    if (totalCost > 0) lines.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
    const totalTokens = turns.reduce((s, t) => s + t.totalTokens, 0);
    if (totalTokens > 0) lines.push(`- **Total tokens:** ${totalTokens}`);
  }
  lines.push("");

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const model = turn.models[0] ? abbreviateModel(turn.models[0]) : "—";
    lines.push(
      `## Turn ${i + 1} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    );
    lines.push("");

    const userText = parseLastUserText(turn.input);
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

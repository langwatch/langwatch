import { Box, Button, Circle, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import {
  LuArrowRight,
  LuCircleAlert,
  LuCircleSlash,
  LuFlaskConical,
  LuQuote,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { EvalSummary } from "../../types/trace";
import { formatCost, formatDuration, truncateId } from "../../utils/formatters";

const STATUS = {
  pass: {
    color: "green.solid",
    fg: "green.fg",
    bg: "green.subtle",
    label: "PASS",
  },
  warning: {
    color: "yellow.solid",
    fg: "yellow.fg",
    bg: "yellow.subtle",
    label: "WARN",
  },
  fail: {
    color: "red.solid",
    fg: "red.fg",
    bg: "red.subtle",
    label: "FAIL",
  },
  // Evaluator wasn't run — provider not configured, preconditions failed,
  // etc. This is a setup state, not a verdict; rendering a 0.00/1.00 score
  // alongside it (the old behavior) lied about what happened.
  skipped: {
    color: "fg.subtle",
    fg: "fg.muted",
    bg: "bg.muted",
    label: "SKIPPED",
  },
  // Evaluator crashed. Distinct from a FAIL verdict — there is no score
  // because the evaluator never produced one.
  error: {
    color: "orange.solid",
    fg: "orange.fg",
    bg: "orange.subtle",
    label: "ERROR",
  },
} as const;

/**
 * "no verdict" states — the evaluator never produced a real score, so the
 * big numeric label, the /1.00 suffix, and the score bar are all
 * meaningless and should be suppressed.
 */
function isNoVerdict(status: EvalSummary["status"]): boolean {
  return status === "skipped" || status === "error";
}

interface EvalRunHistoryEntry {
  score: number | boolean;
  timestamp: number;
  status: string;
}

type EvalEntry = EvalSummary & {
  evaluationId?: string;
  evaluatorId?: string;
  evaluatorType?: string;
  spanName?: string;
  spanId?: string;
  reasoning?: string;
  label?: string;
  passed?: boolean;
  inputs?: Record<string, unknown>;
  errorMessage?: string;
  errorStacktrace?: string[];
  retries?: number;
  executionTime?: number;
  evalCost?: number;
  runHistory?: EvalRunHistoryEntry[];
  timestamp?: number;
};

function RunHistorySparkline({ runs }: { runs: EvalRunHistoryEntry[] }) {
  if (runs.length <= 1) return null;

  const numericRuns = runs
    .filter((r): r is EvalRunHistoryEntry & { score: number } => typeof r.score === "number")
    .slice(-8);

  if (numericRuns.length === 0) {
    return (
      <HStack gap={0.5}>
        {runs.slice(-8).map((r, i) => (
          <Circle
            key={i}
            size="4px"
            bg={r.status === "pass" ? "green.solid" : r.status === "fail" ? "red.solid" : "yellow.solid"}
          />
        ))}
        <Text textStyle="2xs" color="fg.subtle" marginLeft={0.5}>
          ({runs.length})
        </Text>
      </HStack>
    );
  }

  const maxScore = Math.max(...numericRuns.map((r) => r.score));
  const minScore = Math.min(...numericRuns.map((r) => r.score));
  const range = maxScore - minScore || 1;
  const width = 48;
  const height = 14;
  const stepX = width / (numericRuns.length - 1 || 1);

  const points = numericRuns
    .map((r, i) => {
      const x = i * stepX;
      const y = height - ((r.score - minScore) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <HStack gap={1}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ flexShrink: 0 }}
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--chakra-colors-fg-subtle)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Text textStyle="2xs" color="fg.subtle">
        ({runs.length})
      </Text>
    </HStack>
  );
}

function EvalCard({
  eval_,
  onSelectSpan,
}: {
  eval_: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
}) {
  const { name, score, scoreType, status } = eval_;
  const tone = STATUS[status] ?? STATUS.warning;
  const noVerdict = isNoVerdict(status);

  let scoreLabel = "";
  let scoreSubLabel = "";
  let barFill = 0;

  if (!noVerdict) {
    if (scoreType === "boolean") {
      scoreLabel = score === true ? "PASS" : "FAIL";
      barFill = score === true ? 100 : 0;
    } else if (scoreType === "numeric" && typeof score === "number") {
      if (score <= 1) {
        scoreLabel = score.toFixed(2);
        scoreSubLabel = "/ 1.00";
      } else {
        scoreLabel = score.toFixed(1);
        scoreSubLabel = "/ 10";
      }
      barFill = score <= 1 ? score * 100 : Math.min(100, score * 10);
    } else if (scoreType === "categorical") {
      scoreLabel = String(score);
      barFill = 50;
    }
  }

  const hasReasoning = !!eval_.reasoning && eval_.reasoning.length > 0;
  const hasErrorMessage = !!eval_.errorMessage;
  const hasStacktrace =
    !!eval_.errorStacktrace && eval_.errorStacktrace.length > 0;
  const inputEntries = eval_.inputs ? Object.entries(eval_.inputs) : [];
  const hasInputs = inputEntries.length > 0;
  const hasRetries = (eval_.retries ?? 0) > 0;
  // The labeled categorical/boolean verdict is sometimes more informative
  // than the numeric score (e.g. score=1 with label="safe").
  const hasLabel =
    !!eval_.label && eval_.label !== String(eval_.score);

  const meta: string[] = [];
  if (eval_.executionTime !== undefined && eval_.executionTime > 0)
    meta.push(formatDuration(eval_.executionTime));
  if (eval_.evalCost !== undefined && eval_.evalCost > 0)
    meta.push(formatCost(eval_.evalCost));
  if (eval_.evaluatorType) meta.push(eval_.evaluatorType);
  if (hasRetries) meta.push(`${eval_.retries} retr${eval_.retries === 1 ? "y" : "ies"}`);

  // For skipped/error rows the reasoning *is* the message ("provider not
  // configured", "request timed out"). Surface it as the primary content.
  // When `details` is missing we fall back to the error message — the
  // worker always populates one or the other.
  const primaryStatusText =
    eval_.reasoning ?? (status === "error" ? eval_.errorMessage : undefined);
  const showStatusMessage = noVerdict && !!primaryStatusText;
  // Whether the dedicated error-message panel should also appear (only when
  // reasoning was already shown above and we still have a separate error
  // message to surface).
  const showErrorPanel =
    status === "error" && hasErrorMessage && eval_.errorMessage !== eval_.reasoning && !!eval_.reasoning;
  // On errored entries, expose the evaluation/evaluator IDs so support can
  // grep logs without having to dig into the raw payload.
  const showErrorIds =
    status === "error" && (!!eval_.evaluationId || !!eval_.evaluatorId);
  // Whether we have anything that warrants the "Show details" expand.
  const hasExpandableDetails =
    hasInputs || hasStacktrace || hasLabel || showErrorPanel || showErrorIds;
  const hasFooterRow =
    !!eval_.spanName || meta.length > 0 || hasExpandableDetails;

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor="border"
      bg="bg.panel"
      overflow="hidden"
    >
      {/* Header strip */}
      <HStack
        paddingX={3}
        paddingY={2}
        gap={2}
        borderBottomWidth={hasReasoning || meta.length > 0 || eval_.spanName ? "1px" : "0"}
        borderColor="border.muted"
        align="center"
      >
        <HStack
          paddingX={2}
          paddingY={0.5}
          borderRadius="sm"
          bg={tone.bg}
          flexShrink={0}
          gap={1}
        >
          {status === "skipped" && (
            <Icon as={LuCircleSlash} boxSize={2.5} color={tone.fg} />
          )}
          {status === "error" && (
            <Icon as={LuCircleAlert} boxSize={2.5} color={tone.fg} />
          )}
          <Text textStyle="2xs" fontWeight="bold" color={tone.fg} letterSpacing="0.06em">
            {tone.label}
          </Text>
        </HStack>
        <Text
          textStyle="sm"
          fontWeight="semibold"
          color="fg"
          flex={1}
          minWidth={0}
          truncate
        >
          {name}
        </Text>
        {eval_.runHistory && eval_.runHistory.length > 1 && (
          <RunHistorySparkline runs={eval_.runHistory} />
        )}
        {!noVerdict && (
          <HStack gap={0.5} align="baseline" flexShrink={0}>
            <Text
              textStyle="lg"
              fontWeight="bold"
              color={tone.color}
              fontFamily="mono"
              lineHeight={1}
            >
              {scoreLabel}
            </Text>
            {scoreSubLabel && (
              <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                {scoreSubLabel}
              </Text>
            )}
          </HStack>
        )}
      </HStack>

      {/* Score bar (numeric, only when the eval actually produced a score) */}
      {!noVerdict && scoreType === "numeric" && (
        <Box
          height="3px"
          bg="bg.subtle"
          position="relative"
          borderBottomWidth={hasReasoning || meta.length > 0 || eval_.spanName ? "1px" : "0"}
          borderColor="border.muted"
        >
          <Box
            height="100%"
            bg={tone.color}
            width={`${barFill}%`}
            transition="width 0.3s ease"
          />
        </Box>
      )}

      {/* Reasoning / status message */}
      {(hasReasoning || (noVerdict && primaryStatusText)) && (
        <Box
          paddingX={3}
          paddingY={2.5}
          bg={showStatusMessage ? tone.bg : "bg.subtle"}
          borderBottomWidth={hasFooterRow ? "1px" : "0"}
          borderColor="border.muted"
        >
          <HStack align="flex-start" gap={2}>
            <Icon
              as={
                status === "error"
                  ? LuCircleAlert
                  : status === "skipped"
                    ? LuCircleSlash
                    : LuQuote
              }
              boxSize={3}
              color={showStatusMessage ? tone.fg : "fg.subtle"}
              flexShrink={0}
              marginTop={0.5}
            />
            <Text
              textStyle="xs"
              color={showStatusMessage ? tone.fg : "fg.muted"}
              lineHeight="1.6"
              whiteSpace="pre-wrap"
              fontStyle={showStatusMessage ? "normal" : "italic"}
              fontWeight={showStatusMessage ? "medium" : "normal"}
            >
              {showStatusMessage ? primaryStatusText : eval_.reasoning}
            </Text>
          </HStack>
        </Box>
      )}

      {/* Footer: span source, meta, details toggle */}
      {hasFooterRow && (
        <EvalCardFooter
          eval_={eval_}
          onSelectSpan={onSelectSpan}
          meta={meta}
          tone={tone}
          inputEntries={inputEntries}
          hasInputs={hasInputs}
          hasStacktrace={hasStacktrace}
          hasLabel={hasLabel}
          showErrorPanel={showErrorPanel}
          showErrorIds={showErrorIds}
          hasExpandableDetails={hasExpandableDetails}
        />
      )}
    </Box>
  );
}

function EvalCardFooter({
  eval_,
  onSelectSpan,
  meta,
  tone,
  inputEntries,
  hasInputs,
  hasStacktrace,
  hasLabel,
  showErrorPanel,
  showErrorIds,
  hasExpandableDetails,
}: {
  eval_: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
  meta: string[];
  tone: (typeof STATUS)[keyof typeof STATUS];
  inputEntries: [string, unknown][];
  hasInputs: boolean;
  hasStacktrace: boolean;
  hasLabel: boolean;
  showErrorPanel: boolean;
  showErrorIds: boolean;
  hasExpandableDetails: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <HStack
        paddingX={3}
        paddingY={1.5}
        gap={3}
        color="fg.subtle"
        flexWrap="wrap"
      >
        {eval_.spanName && (
          <HStack gap={1}>
            <Text textStyle="2xs">from</Text>
            <Flex
              as="button"
              align="center"
              textStyle="2xs"
              color="blue.fg"
              fontFamily="mono"
              cursor="pointer"
              onClick={() => eval_.spanId && onSelectSpan?.(eval_.spanId)}
              _hover={{ textDecoration: "underline" }}
            >
              {eval_.spanName}
            </Flex>
          </HStack>
        )}
        {meta.map((m, i) => (
          <Text key={i} textStyle="2xs" fontFamily="mono">
            {m}
          </Text>
        ))}
        {hasExpandableDetails && (
          <Button
            size="2xs"
            variant="ghost"
            marginLeft="auto"
            paddingX={1.5}
            height="20px"
            onClick={() => setOpen((v) => !v)}
            color="fg.muted"
            _hover={{ color: "fg", bg: "bg.muted" }}
            gap={0.5}
          >
            <Text textStyle="2xs" fontWeight="medium">
              {open ? "Hide details" : "Show details"}
            </Text>
          </Button>
        )}
      </HStack>
      {open && hasExpandableDetails && (
        <VStack
          align="stretch"
          gap={0}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.subtle"
        >
          {hasLabel && (
            <DetailRow label="Label">
              <Text
                textStyle="xs"
                fontFamily="mono"
                color="fg"
                fontWeight="medium"
              >
                {eval_.label}
                {eval_.passed != null && (
                  <Text
                    as="span"
                    textStyle="2xs"
                    color={eval_.passed ? "green.fg" : "red.fg"}
                    marginLeft={2}
                  >
                    ({eval_.passed ? "passed" : "failed"})
                  </Text>
                )}
              </Text>
            </DetailRow>
          )}
          {showErrorPanel && eval_.errorMessage && (
            <DetailRow label="Error">
              <Text
                textStyle="xs"
                color={tone.fg}
                fontFamily="mono"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
              >
                {eval_.errorMessage}
              </Text>
            </DetailRow>
          )}
          {showErrorIds && (
            <DetailRow label="IDs">
              <VStack align="stretch" gap={1}>
                {eval_.evaluationId && (
                  <HStack align="flex-start" gap={2} minWidth={0}>
                    <Text
                      textStyle="2xs"
                      fontFamily="mono"
                      color="fg.subtle"
                      flexShrink={0}
                      minWidth="80px"
                    >
                      evaluation
                    </Text>
                    <Text
                      textStyle="2xs"
                      fontFamily="mono"
                      color="fg"
                      wordBreak="break-all"
                    >
                      {eval_.evaluationId}
                    </Text>
                  </HStack>
                )}
                {eval_.evaluatorId && (
                  <HStack align="flex-start" gap={2} minWidth={0}>
                    <Text
                      textStyle="2xs"
                      fontFamily="mono"
                      color="fg.subtle"
                      flexShrink={0}
                      minWidth="80px"
                    >
                      evaluator
                    </Text>
                    <Text
                      textStyle="2xs"
                      fontFamily="mono"
                      color="fg"
                      wordBreak="break-all"
                    >
                      {eval_.evaluatorId}
                    </Text>
                  </HStack>
                )}
              </VStack>
            </DetailRow>
          )}
          {hasStacktrace && (
            <DetailRow label="Stacktrace">
              <Box
                as="pre"
                textStyle="2xs"
                fontFamily="mono"
                color="fg.muted"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                bg="bg.panel"
                borderRadius="sm"
                paddingX={2}
                paddingY={1.5}
                margin={0}
                maxHeight="240px"
                overflow="auto"
              >
                {eval_.errorStacktrace!.join("\n")}
              </Box>
            </DetailRow>
          )}
          {hasInputs && (
            <DetailRow label="Inputs">
              <VStack align="stretch" gap={1}>
                {inputEntries.map(([key, value]) => (
                  <HStack key={key} align="flex-start" gap={2} minWidth={0}>
                    <Text
                      textStyle="2xs"
                      fontFamily="mono"
                      color="fg.subtle"
                      flexShrink={0}
                      minWidth="80px"
                    >
                      {key}
                    </Text>
                    <Box
                      as="pre"
                      textStyle="2xs"
                      fontFamily="mono"
                      color="fg"
                      whiteSpace="pre-wrap"
                      wordBreak="break-word"
                      margin={0}
                      flex={1}
                      maxHeight="160px"
                      overflow="auto"
                    >
                      {formatInputValue(value)}
                    </Box>
                  </HStack>
                ))}
              </VStack>
            </DetailRow>
          )}
        </VStack>
      )}
    </>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      paddingX={3}
      paddingY={2}
      _notFirst={{ borderTopWidth: "1px", borderColor: "border.muted" }}
    >
      <Text
        textStyle="2xs"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.06em"
        fontWeight="600"
        marginBottom={1}
      >
        {label}
      </Text>
      {children}
    </Box>
  );
}

function formatInputValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface EvalsListProps {
  evals: EvalEntry[];
  onSelectSpan?: (spanId: string) => void;
}

/** Group key for stacking: evaluatorId if known, else fall back to name. */
function evalGroupKey(e: EvalEntry): string {
  return e.evaluatorId ?? `name:${e.name}`;
}

export function EvalsList({ evals, onSelectSpan }: EvalsListProps) {
  if (!evals || evals.length === 0) {
    return (
      <VStack gap={2} alignItems="center" textAlign="center" maxWidth="220px" marginX="auto" paddingY={3}>
        <Icon as={LuFlaskConical} boxSize={5} color="fg.subtle" />
        <VStack gap={1}>
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">No evaluations yet</Text>
          <Text textStyle="xs" color="fg.subtle">
            Set up evaluators to automatically score traces on quality, safety, and accuracy.
          </Text>
        </VStack>
        <Button size="xs" variant="outline" asChild>
          <a href="https://docs.langwatch.ai/evaluations/overview" target="_blank" rel="noopener noreferrer">
            Learn more
          </a>
        </Button>
      </VStack>
    );
  }

  // Group runs by evaluator, then sort each group newest-first. The first
  // entry in each group is the head card; the rest collapse into a history
  // panel so a noisy evaluator doesn't dominate the section.
  const groups = new Map<string, EvalEntry[]>();
  for (const e of evals) {
    const key = evalGroupKey(e);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const orderedGroups = Array.from(groups.values()).map((entries) =>
    [...entries].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
  );
  // Order groups by their head entry's timestamp (newest evaluator first).
  orderedGroups.sort(
    (a, b) => (b[0]?.timestamp ?? 0) - (a[0]?.timestamp ?? 0),
  );

  return (
    <VStack align="stretch" gap={2}>
      {orderedGroups.map((group) => (
        <EvalGroup
          key={evalGroupKey(group[0]!)}
          entries={group}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </VStack>
  );
}

function EvalGroup({
  entries,
  onSelectSpan,
}: {
  entries: EvalEntry[];
  onSelectSpan?: (spanId: string) => void;
}) {
  const head = entries[0]!;
  const history = entries.slice(1);

  // Synthesize a runHistory sparkline from older entries when the eval
  // doesn't carry one already.
  const synthesizedHistory: EvalRunHistoryEntry[] | undefined =
    history.length > 0
      ? entries
          .filter((e): e is EvalEntry & { timestamp: number } => e.timestamp != null)
          .map((e) => ({
            score: e.score,
            timestamp: e.timestamp,
            status: e.status,
          }))
      : undefined;

  const headWithHistory: EvalEntry = {
    ...head,
    runHistory: head.runHistory ?? synthesizedHistory,
  };

  return (
    <VStack align="stretch" gap={0}>
      <EvalCard eval_={headWithHistory} onSelectSpan={onSelectSpan} />
      {history.length > 0 && (
        <EvalHistoryStack entries={history} onSelectSpan={onSelectSpan} />
      )}
    </VStack>
  );
}

function EvalHistoryStack({
  entries,
  onSelectSpan,
}: {
  entries: EvalEntry[];
  onSelectSpan?: (spanId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box
      borderLeftWidth="2px"
      borderLeftColor="border.muted"
      marginLeft={3}
      paddingLeft={3}
      paddingTop={1}
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        gap={1}
        paddingX={1.5}
        height="22px"
        color="fg.muted"
        _hover={{ color: "fg", bg: "bg.muted" }}
      >
        <Text textStyle="2xs" fontWeight="medium">
          {expanded ? "Hide" : "Show"} {entries.length} earlier run
          {entries.length === 1 ? "" : "s"}
        </Text>
      </Button>
      {expanded && (
        <VStack align="stretch" gap={1} paddingTop={1.5}>
          {entries.map((e, i) => (
            <EvalHistoryRow
              key={i}
              entry={e}
              onSelectSpan={onSelectSpan}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}

function EvalHistoryRow({
  entry,
  onSelectSpan,
}: {
  entry: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
}) {
  const status = STATUS[entry.status as keyof typeof STATUS] ?? STATUS.warning;
  const noVerdict = isNoVerdict(entry.status);
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString()
    : null;
  const scoreLabel = noVerdict
    ? null
    : typeof entry.score === "boolean"
      ? entry.score
        ? "true"
        : "false"
      : typeof entry.score === "number"
        ? entry.score.toFixed(2)
        : "—";
  const canJump = !!entry.spanId && !!onSelectSpan;
  return (
    <HStack
      gap={2}
      paddingX={2}
      paddingY={1}
      borderRadius="sm"
      _hover={{ bg: "bg.muted" }}
    >
      <Circle size="6px" bg={status.color} flexShrink={0} />
      <Text textStyle="2xs" color={status.fg} fontWeight="medium" flexShrink={0}>
        {status.label}
      </Text>
      {scoreLabel !== null && (
        <Text textStyle="xs" fontFamily="mono" color="fg" flexShrink={0}>
          {scoreLabel}
        </Text>
      )}
      {time && (
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" flexShrink={0}>
          {time}
        </Text>
      )}
      {entry.spanId ? (
        <Tooltip
          content={
            entry.spanName ? (
              <VStack align="stretch" gap={0.5} minWidth="180px">
                <HStack justify="space-between" gap={4}>
                  <Text textStyle="2xs" color="fg.muted">name</Text>
                  <Text textStyle="2xs" fontFamily="mono" color="fg">
                    {entry.spanName}
                  </Text>
                </HStack>
                <HStack justify="space-between" gap={4}>
                  <Text textStyle="2xs" color="fg.muted">id</Text>
                  <Text textStyle="2xs" fontFamily="mono" color="fg">
                    {entry.spanId}
                  </Text>
                </HStack>
                {canJump && (
                  <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
                    Click to jump to span
                  </Text>
                )}
              </VStack>
            ) : (
              <Text textStyle="2xs" fontFamily="mono">
                {entry.spanId}
              </Text>
            )
          }
          positioning={{ placement: "top" }}
        >
          <HStack
            as={canJump ? "button" : "div"}
            gap={1.5}
            marginLeft="auto"
            minWidth={0}
            cursor={canJump ? "pointer" : "default"}
            onClick={
              canJump ? () => onSelectSpan!(entry.spanId!) : undefined
            }
            color="fg.muted"
            _hover={canJump ? { color: "fg" } : undefined}
            transition="color 0.12s ease"
          >
            {entry.spanName && (
              <Text
                textStyle="2xs"
                fontFamily="mono"
                color="inherit"
                truncate
                maxWidth="160px"
              >
                {entry.spanName}
              </Text>
            )}
            <Text
              textStyle="2xs"
              fontFamily="mono"
              color="fg.subtle"
              flexShrink={0}
            >
              {truncateId(entry.spanId)}
            </Text>
            {canJump && (
              <Icon as={LuArrowRight} boxSize={2.5} flexShrink={0} />
            )}
          </HStack>
        </Tooltip>
      ) : (
        <Box flex={1} />
      )}
    </HStack>
  );
}

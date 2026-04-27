import { Box, Button, Circle, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuFlaskConical, LuQuote } from "react-icons/lu";
import type { EvalSummary } from "../../types/trace";
import { formatCost, formatDuration } from "../../utils/formatters";

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
} as const;

interface EvalRunHistoryEntry {
  score: number | boolean;
  timestamp: number;
  status: string;
}

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
  eval_: EvalSummary & {
    spanName?: string;
    spanId?: string;
    reasoning?: string;
    executionTime?: number;
    evalCost?: number;
    runHistory?: EvalRunHistoryEntry[];
  };
  onSelectSpan?: (spanId: string) => void;
}) {
  const { name, score, scoreType, status } = eval_;
  const tone = STATUS[status] ?? STATUS.warning;

  let scoreLabel = "";
  let scoreSubLabel = "";
  let barFill = 0;

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

  const hasReasoning = !!eval_.reasoning && eval_.reasoning.length > 0;
  const meta: string[] = [];
  if (eval_.executionTime !== undefined) meta.push(formatDuration(eval_.executionTime));
  if (eval_.evalCost !== undefined && eval_.evalCost > 0)
    meta.push(formatCost(eval_.evalCost));

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
        <Box
          paddingX={2}
          paddingY={0.5}
          borderRadius="sm"
          bg={tone.bg}
          flexShrink={0}
        >
          <Text textStyle="2xs" fontWeight="bold" color={tone.fg} letterSpacing="0.06em">
            {tone.label}
          </Text>
        </Box>
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
      </HStack>

      {/* Score bar (numeric only) */}
      {scoreType === "numeric" && (
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

      {/* Reasoning */}
      {hasReasoning && (
        <Box
          paddingX={3}
          paddingY={2.5}
          bg="bg.subtle"
          borderBottomWidth={meta.length > 0 || eval_.spanName ? "1px" : "0"}
          borderColor="border.muted"
        >
          <HStack align="flex-start" gap={2}>
            <Icon
              as={LuQuote}
              boxSize={3}
              color="fg.subtle"
              flexShrink={0}
              marginTop={0.5}
            />
            <Text
              textStyle="xs"
              color="fg.muted"
              lineHeight="1.6"
              whiteSpace="pre-wrap"
              fontStyle="italic"
            >
              {eval_.reasoning}
            </Text>
          </HStack>
        </Box>
      )}

      {/* Footer: span source, meta */}
      {(eval_.spanName || meta.length > 0) && (
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
        </HStack>
      )}
    </Box>
  );
}

interface EvalsListProps {
  evals: Array<
    EvalSummary & {
      spanName?: string;
      spanId?: string;
      reasoning?: string;
      executionTime?: number;
      evalCost?: number;
      runHistory?: EvalRunHistoryEntry[];
    }
  >;
  onSelectSpan?: (spanId: string) => void;
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

  return (
    <VStack align="stretch" gap={2}>
      {evals.map((e, i) => (
        <EvalCard key={i} eval_={e} onSelectSpan={onSelectSpan} />
      ))}
    </VStack>
  );
}

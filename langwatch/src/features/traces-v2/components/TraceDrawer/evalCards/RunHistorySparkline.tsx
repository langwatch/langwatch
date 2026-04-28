import { Circle, HStack, Text } from "@chakra-ui/react";
import type { EvalRunHistoryEntry } from "./utils";

export function RunHistorySparkline({ runs }: { runs: EvalRunHistoryEntry[] }) {
  if (runs.length <= 1) return null;

  const numericRuns = runs
    .filter(
      (r): r is EvalRunHistoryEntry & { score: number } =>
        typeof r.score === "number",
    )
    .slice(-8);

  if (numericRuns.length === 0) {
    return (
      <HStack gap={0.5}>
        {runs.slice(-8).map((r, i) => (
          <Circle
            key={i}
            size="4px"
            bg={
              r.status === "pass"
                ? "green.solid"
                : r.status === "fail"
                  ? "red.solid"
                  : "yellow.solid"
            }
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

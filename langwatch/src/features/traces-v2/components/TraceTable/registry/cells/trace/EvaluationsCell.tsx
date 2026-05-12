import { HStack, Text } from "@chakra-ui/react";
import type {
  TraceEvalResult,
  TraceListItem,
} from "../../../../../types/trace";
import { EvalChip } from "../../sharedChips";
import type { CellDef } from "../../types";

const MAX_EVALS = 9;

type Density = "compact" | "comfortable";

// Server returns evaluations ordered by UpdatedAt DESC, so the first
// occurrence per evaluator is the latest run — keep that one and drop
// older re-runs.
function dedupeLatest(evals: TraceEvalResult[]): TraceEvalResult[] {
  const seen = new Set<string>();
  const result: TraceEvalResult[] = [];
  for (const ev of evals) {
    const key = ev.evaluatorId || ev.evaluatorName || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(ev);
  }
  return result;
}

function renderEvaluations(row: TraceListItem, density: Density) {
  const evals = dedupeLatest(row.evaluations);
  const textStyle = density === "compact" ? "xs" : "sm";
  if (evals.length === 0) {
    return (
      <Text textStyle={textStyle} color="fg.subtle">
        —
      </Text>
    );
  }
  const visible = evals.slice(0, MAX_EVALS);
  const overflow = evals.length - visible.length;
  const gap = density === "compact" ? 1 : 1.5;
  return (
    <HStack gap={gap} flexWrap="wrap">
      {visible.map((ev, i) => (
        <EvalChip key={`${ev.evaluatorId}-${i}`} eval_={ev} />
      ))}
      {overflow > 0 && <MoreEvalsPill count={overflow} />}
    </HStack>
  );
}

export const EvaluationsCell = {
  id: "evaluations",
  label: "Evals",
  render: ({ row }) => renderEvaluations(row, "compact"),
  renderComfortable: ({ row }) => renderEvaluations(row, "comfortable"),
} as const satisfies CellDef<TraceListItem>;

function MoreEvalsPill({ count }: { count: number }) {
  return (
    <HStack
      gap={1}
      paddingX={2}
      paddingY={0.5}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      flexShrink={0}
    >
      <Text
        textStyle="2xs"
        fontWeight="medium"
        color="fg.muted"
        whiteSpace="nowrap"
        lineHeight="1.2"
      >
        +{count} more
      </Text>
    </HStack>
  );
}

import { HStack, Text } from "@chakra-ui/react";
import type { TraceEvalResult, TraceListItem } from "../../../../../types/trace";
import { EvalChip } from "../../sharedChips";
import type { CellDef } from "../../types";

const MAX_EVALS = 9;

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

export const EvaluationsCell: CellDef<TraceListItem> = {
  id: "evaluations",
  label: "Evals",
  render: ({ row }) => {
    const evals = dedupeLatest(row.evaluations);
    if (evals.length === 0) {
      return (
        <Text textStyle="xs" color="fg.subtle">
          —
        </Text>
      );
    }
    const visible = evals.slice(0, MAX_EVALS);
    const overflow = evals.length - visible.length;
    return (
      <HStack gap={1} flexWrap="wrap">
        {visible.map((ev, i) => (
          <EvalChip key={`${ev.evaluatorId}-${i}`} eval_={ev} />
        ))}
        {overflow > 0 && <MoreEvalsPill count={overflow} />}
      </HStack>
    );
  },
  renderComfortable: ({ row }) => {
    const evals = dedupeLatest(row.evaluations);
    if (evals.length === 0) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    const visible = evals.slice(0, MAX_EVALS);
    const overflow = evals.length - visible.length;
    return (
      <HStack gap={1.5} flexWrap="wrap">
        {visible.map((ev, i) => (
          <EvalChip key={`${ev.evaluatorId}-${i}`} eval_={ev} />
        ))}
        {overflow > 0 && <MoreEvalsPill count={overflow} />}
      </HStack>
    );
  },
};

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

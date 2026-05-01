import { Circle, HStack, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { evalChipColor, formatEvalScore } from "../../sharedChips";
import type { CellDef } from "../../types";

interface EvalKey {
  evaluatorId: string;
  evaluatorName: string | null;
}

export function uniqueEvaluators(rows: TraceListItem[]): EvalKey[] {
  const seen = new Map<string, EvalKey>();
  for (const row of rows) {
    for (const ev of row.evaluations) {
      if (!seen.has(ev.evaluatorId)) {
        seen.set(ev.evaluatorId, {
          evaluatorId: ev.evaluatorId,
          evaluatorName: ev.evaluatorName,
        });
      }
    }
  }
  return [...seen.values()];
}

export function makeEvalCellDef(key: EvalKey): CellDef<TraceListItem> {
  const label = key.evaluatorName ?? key.evaluatorId;
  return {
    id: `eval:${key.evaluatorId}`,
    label,
    render: ({ row }) => {
      const ev = row.evaluations.find((e) => e.evaluatorId === key.evaluatorId);
      if (!ev) {
        return (
          <Text textStyle="sm" color="fg.subtle">
            —
          </Text>
        );
      }
      const color = evalChipColor(ev);
      const scoreText = formatEvalScore(ev);
      return (
        <HStack gap={1.5}>
          <Circle size="8px" bg={color} flexShrink={0} />
          {scoreText ? (
            <Text textStyle="sm" color="fg.muted" fontFamily="mono">
              {scoreText}
            </Text>
          ) : ev.passed != null ? (
            <Text
              textStyle="sm"
              fontWeight="500"
              color={ev.passed ? "green.fg" : "red.fg"}
            >
              {ev.passed ? "Pass" : "Fail"}
            </Text>
          ) : (
            <Text textStyle="sm" color="fg.subtle">
              {ev.status}
            </Text>
          )}
        </HStack>
      );
    },
  };
}

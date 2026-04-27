import { HStack, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { EvalChip } from "../../sharedChips";
import type { CellDef } from "../../types";

export const EvaluationsCell: CellDef<TraceListItem> = {
  id: "evaluations",
  label: "Evals",
  render: ({ row }) => {
    if (row.evaluations.length === 0) {
      return (
        <Text textStyle="xs" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1} flexWrap="wrap">
        {row.evaluations.map((ev, i) => (
          <EvalChip key={`${ev.evaluatorId}-${i}`} eval_={ev} />
        ))}
      </HStack>
    );
  },
  renderComfortable: ({ row }) => {
    if (row.evaluations.length === 0) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1.5} flexWrap="wrap">
        {row.evaluations.map((ev, i) => (
          <EvalChip key={`${ev.evaluatorId}-${i}`} eval_={ev} />
        ))}
      </HStack>
    );
  },
};

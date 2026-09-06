import { Circle, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { getEvalChipDisplay } from "~/utils/evaluationResults";
import {
  EVAL_FIELD_LABELS,
  type EvalColumnField,
} from "../../../../../lens/evalColumnId";
import type { TraceListItem } from "../../../../../types/trace";
import { latestEvalForKey } from "../../../evalColumns";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";

type Density = "compact" | "comfortable";

/**
 * One per-evaluator eval column cell. Renders the chosen field of the
 * evaluator's latest run on the trace — Score (with a status-coloured
 * dot), Verdict (Pass / Fail), or Label (the categorical text) — and an
 * em-dash when the trace has no run or the chosen field has no value.
 *
 * Colour and score formatting come from `getEvalChipDisplay` so this cell
 * never drifts from the `EvalChip` summary badges or the drawer header.
 */
const EvalResultCellView: React.FC<{
  row: TraceListItem;
  evaluatorKey: string;
  field: EvalColumnField;
  density: Density;
}> = ({ row, evaluatorKey, field, density }) => {
  const ev = latestEvalForKey({ row, evaluatorKey });
  if (!ev) return dash;

  const textStyle = density === "compact" ? "xs" : "sm";
  const display = getEvalChipDisplay(ev);

  if (field === "verdict") {
    if (ev.passed == null) return dash;
    return (
      <ValueWithDot
        dotColor={ev.passed ? "green.500" : "red.500"}
        text={ev.passed ? "Pass" : "Fail"}
        textColor={ev.passed ? "green.fg" : "red.fg"}
        textStyle={textStyle}
      />
    );
  }

  if (field === "label") {
    if (!ev.label) return dash;
    return (
      <ValueWithDot
        dotColor={display.color}
        text={ev.label}
        textStyle={textStyle}
      />
    );
  }

  // Score
  if (display.scoreText == null) return dash;
  return (
    <ValueWithDot
      dotColor={display.color}
      text={display.scoreText}
      textStyle={textStyle}
    />
  );
};

function ValueWithDot({
  dotColor,
  text,
  textColor = "fg",
  textStyle,
}: {
  dotColor: string;
  text: string;
  textColor?: string;
  textStyle: string;
}) {
  return (
    <HStack gap={1.5} minWidth={0}>
      <Circle size="8px" bg={dotColor} flexShrink={0} />
      <Text textStyle={textStyle} color={textColor} truncate lineHeight="1.2">
        {text}
      </Text>
    </HStack>
  );
}

/**
 * Build the registry cell def for a per-evaluator eval column. Merged into
 * the trace registry at runtime by `useTraceLensColumns` (the static
 * `traceCells` map only knows the fixed column set).
 */
export function makeEvalCellDef({
  id,
  evaluatorKey,
  field,
}: {
  id: string;
  evaluatorKey: string;
  field: EvalColumnField;
}): CellDef<TraceListItem> {
  return {
    id,
    label: EVAL_FIELD_LABELS[field],
    render: ({ row }) => (
      <EvalResultCellView
        row={row}
        evaluatorKey={evaluatorKey}
        field={field}
        density="compact"
      />
    ),
    renderComfortable: ({ row }) => (
      <EvalResultCellView
        row={row}
        evaluatorKey={evaluatorKey}
        field={field}
        density="comfortable"
      />
    ),
  };
}

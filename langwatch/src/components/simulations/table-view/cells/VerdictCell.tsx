import { Badge } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { Verdict } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunRow } from "../types";

const verdictColors: Record<Verdict, string> = {
  [Verdict.SUCCESS]: "green",
  [Verdict.FAILURE]: "red",
  [Verdict.INCONCLUSIVE]: "yellow",
};

const verdictLabels: Record<Verdict, string> = {
  [Verdict.SUCCESS]: "Pass",
  [Verdict.FAILURE]: "Fail",
  [Verdict.INCONCLUSIVE]: "Inconclusive",
};

export function VerdictCell({
  getValue,
}: CellContext<ScenarioRunRow, unknown>) {
  const verdict = getValue() as Verdict | null;

  if (!verdict) {
    return <span>-</span>;
  }

  const colorPalette = verdictColors[verdict] ?? "gray";
  const label = verdictLabels[verdict] ?? verdict;

  return (
    <Badge colorPalette={colorPalette} variant="subtle" size="sm">
      {label}
    </Badge>
  );
}

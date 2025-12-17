import { Badge } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunRow } from "../types";

const statusColors: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "green",
  [ScenarioRunStatus.ERROR]: "red",
  [ScenarioRunStatus.FAILED]: "red",
  [ScenarioRunStatus.CANCELLED]: "gray",
  [ScenarioRunStatus.IN_PROGRESS]: "blue",
  [ScenarioRunStatus.PENDING]: "yellow",
};

const statusLabels: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "Success",
  [ScenarioRunStatus.ERROR]: "Error",
  [ScenarioRunStatus.FAILED]: "Failed",
  [ScenarioRunStatus.CANCELLED]: "Cancelled",
  [ScenarioRunStatus.IN_PROGRESS]: "In Progress",
  [ScenarioRunStatus.PENDING]: "Pending",
};

export function StatusCell({
  getValue,
}: CellContext<ScenarioRunRow, unknown>) {
  const status = getValue() as ScenarioRunStatus;
  const colorPalette = statusColors[status] ?? "gray";
  const label = statusLabels[status] ?? status;

  return (
    <Badge colorPalette={colorPalette} variant="subtle" size="sm">
      {label}
    </Badge>
  );
}

import { Badge } from "@langwatch/design-system/primitives";

import type { InsightScheduleStatus } from "../../model/insight-schedule-presentation.ts";

const PRESENTATION: Record<InsightScheduleStatus, { label: string; palette: string }> = {
  not_armed: { label: "Not armed", palette: "red" },
  skipping: { label: "Skipping", palette: "orange" },
  on: { label: "On", palette: "green" },
  turned_off: { label: "Turned off", palette: "gray" },
  off: { label: "Off", palette: "gray" },
};

/** Whether a daily insights schedule is on, and whether somebody should look at it. */
export function InsightScheduleStatusBadge({ status }: { status: InsightScheduleStatus }) {
  const { label, palette } = PRESENTATION[status];

  return (
    <Badge colorPalette={palette} variant={status === "not_armed" ? "solid" : "subtle"}>
      {label}
    </Badge>
  );
}

import { Badge } from "@langwatch/design-system/primitives";
import type { RedTeamOutcome } from "@langwatch/scenario-contract";

import { RED_TEAM_OUTCOME_LABELS } from "../../model/red-team-report.ts";

/** Held (the target resisted the attack) in the success palette, Broke in the danger one. */
export function RedTeamOutcomeBadge({ outcome }: { outcome: RedTeamOutcome }) {
  const palette = outcome === "held" ? "green" : "red";
  return (
    <Badge
      colorPalette={palette}
      data-palette={palette}
      variant="subtle"
      size="sm"
      data-testid="red-team-outcome"
    >
      {RED_TEAM_OUTCOME_LABELS[outcome]}
    </Badge>
  );
}

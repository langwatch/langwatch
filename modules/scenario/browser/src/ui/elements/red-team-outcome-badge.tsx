import { Badge } from "@langwatch/design-system/primitives";
import type { RedTeamOutcome } from "@langwatch/scenario-contract";

import { RED_TEAM_OUTCOME_LABELS, RED_TEAM_OUTCOME_PALETTES } from "../../model/red-team-report.ts";

/** Held (the target resisted the attack) in the success palette, Broke in the danger one. */
export function RedTeamOutcomeBadge({ outcome }: { outcome: RedTeamOutcome }) {
  const palette = RED_TEAM_OUTCOME_PALETTES[outcome];
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

import { Badge } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { AgentRegistryPosture } from "@langwatch/enterprise-governance-contract";

import { AGENT_POSTURE_LABELS } from "./agent-filters";

/**
 * The registry's posture for one agent, as the row and the card both draw it. Nothing renders
 * while the registry holds no entry for the agent.
 * @see enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
const POSTURE_TONES: Record<AgentRegistryPosture, string> = {
  governed: "green",
  shadow: "red",
  dormant: "gray",
};

const POSTURE_MEANINGS: Record<AgentRegistryPosture, string> = {
  governed:
    "Listed by a connected source. Traces are checked once it is older than the dormancy window.",
  shadow: "Seen in traces, but no connected source lists it.",
  dormant: "Listed by a connected source, with no traces in the dormancy window.",
};

export function AgentPostureBadge({ posture }: { posture: AgentRegistryPosture | null }) {
  if (posture === null) return null;
  return (
    <Tooltip content={POSTURE_MEANINGS[posture]}>
      <Badge
        size="xs"
        variant="subtle"
        colorPalette={POSTURE_TONES[posture]}
        data-testid="agent-posture"
        data-posture={posture}
      >
        {AGENT_POSTURE_LABELS[posture]}
      </Badge>
    </Tooltip>
  );
}

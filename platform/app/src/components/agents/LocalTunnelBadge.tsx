import { Badge } from "@chakra-ui/react";

import { Tooltip } from "../ui/tooltip";

/**
 * Whether an agent currently points at a `langwatch agent dev` tunnel: an
 * HTTP agent whose config carries the `devTunnel` marker the CLI writes for
 * the session and removes on exit.
 */
export function agentHasDevTunnel(agent: {
  type: string;
  config?: unknown;
}): boolean {
  if (agent.type !== "http") return false;
  const config = agent.config;
  return (
    !!config &&
    typeof config === "object" &&
    "devTunnel" in config &&
    !!(config as { devTunnel?: unknown }).devTunnel
  );
}

/**
 * Marks an agent that points at a developer's machine, in the agents list and
 * the simulations target selector, so a temporarily repointed agent is never
 * mistaken for its deployed self.
 */
export function LocalTunnelBadge() {
  return (
    <Tooltip content="Points at a local development tunnel started with langwatch agent dev">
      <Badge size="xs" variant="subtle" colorPalette="orange">
        Local tunnel
      </Badge>
    </Tooltip>
  );
}

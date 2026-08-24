import { Badge } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";

export function agentHasDevTunnel(agent: {
  type: string;
  config?: unknown;
}): boolean {
  if (agent.type !== "http") return false;
  const config = agent.config;
  return Boolean(
    config &&
    typeof config === "object" &&
    "devTunnel" in config &&
    (config as { devTunnel?: unknown }).devTunnel,
  );
}

export function LocalTunnelBadge() {
  return (
    <Tooltip content="Points at a local development tunnel started with langwatch agent dev">
      <Badge size="xs" variant="subtle" colorPalette="orange">
        Local tunnel
      </Badge>
    </Tooltip>
  );
}

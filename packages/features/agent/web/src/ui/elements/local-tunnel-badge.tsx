import { Badge } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";

export function LocalTunnelBadge() {
  return (
    <Tooltip content="Points at a local development tunnel started with langwatch agent dev">
      <Badge size="xs" variant="subtle" colorPalette="orange">
        Local tunnel
      </Badge>
    </Tooltip>
  );
}

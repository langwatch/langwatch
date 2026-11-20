// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Badge } from "@langwatch/design-system/primitives";
import type { AgentStopStatus } from "@langwatch/enterprise-governance-contract";

import { stopStatusChip } from "../../model/kill-switch-copy.ts";

/** An agent's open stop as one word on its row; a stop that is over draws nothing. */
export function AgentStopStatusChip({ status }: { status: AgentStopStatus }) {
  const chip = stopStatusChip(status);
  if (!chip) return null;
  return (
    <Badge
      size="xs"
      variant="subtle"
      colorPalette={chip.palette}
      data-testid="agent-stop-status"
      data-status={status}
    >
      {chip.label}
    </Badge>
  );
}

/** The one quiet "Enterprise" badge on whatever the Enterprise plan gates, wherever it sits. */
import { Badge } from "@chakra-ui/react";
import { LockKeyhole } from "lucide-react";

import { Tooltip } from "../overlays/tooltip.tsx";

export interface EnterpriseBadgeProps {
  "data-testid"?: string;
  /** A menu row: a lock in the same hairline chip, named "Enterprise" by tooltip and label. */
  compact?: boolean;
}

export function EnterpriseBadge({ "data-testid": testId, compact = false }: EnterpriseBadgeProps) {
  if (compact) {
    return (
      <Tooltip content="Enterprise" positioning={{ placement: "right" }} showArrow>
        <Badge
          variant="outline"
          colorPalette="gray"
          size="sm"
          flexShrink={0}
          paddingX="1"
          data-testid={testId}
        >
          <LockKeyhole size={12} aria-label="Enterprise" />
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Badge
      title="Enterprise plan feature"
      variant="outline"
      colorPalette="gray"
      size="sm"
      flexShrink={0}
      data-testid={testId}
    >
      Enterprise
    </Badge>
  );
}

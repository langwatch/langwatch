/** The one quiet "Enterprise" badge on whatever the Enterprise plan gates, wherever it sits. */
import { Badge } from "@chakra-ui/react";

export interface EnterpriseBadgeProps {
  "data-testid"?: string;
}

export function EnterpriseBadge({ "data-testid": testId }: EnterpriseBadgeProps) {
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

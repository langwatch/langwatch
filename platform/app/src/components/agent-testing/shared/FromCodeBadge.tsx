/**
 * The small grey mark that says a set, a plan or a target came from code
 * rather than from the platform. One component, so every surface that marks
 * one reads the same way.
 */

import { Badge } from "@chakra-ui/react";

export function FromCodeBadge() {
  return (
    <Badge
      size="xs"
      variant="subtle"
      colorPalette="gray"
      title="Defined and run from your codebase; results land here"
      data-testid="from-code-badge"
    >
      from code
    </Badge>
  );
}

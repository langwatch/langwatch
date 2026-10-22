// A braid's condition in code style, or "Every span" when it braids every span.

import { InlineCode } from "@langwatch/design-system/inline-code";
import { Text } from "@langwatch/design-system/primitives";

export function BraidCondition({ where }: { where: string | null }) {
  if (!where) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Every span
      </Text>
    );
  }
  return <InlineCode truncate="end">{where}</InlineCode>;
}

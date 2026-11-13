// A braid's condition as highlighted code, or "Every span" when it braids every span.

import { HighlightedExpression } from "@langwatch/design-system/highlighted-expression";
import { Text } from "@langwatch/design-system/primitives";

export function BraidCondition({ where }: { where: string | null }) {
  if (!where) {
    return (
      <Text textStyle="sm" color="fg.muted">
        Every span
      </Text>
    );
  }
  return <HighlightedExpression code={where} data-testid="braid-condition-code" />;
}

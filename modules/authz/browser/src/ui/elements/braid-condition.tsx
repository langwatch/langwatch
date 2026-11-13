// A braid's condition as highlighted code on its own lines, with `Verified("k")` said as a Signed
// badge beside it; "Every span" when it braids every span.

import { HighlightedExpression } from "@langwatch/design-system/highlighted-expression";
import { Badge, HStack, Text } from "@langwatch/design-system/primitives";
import { ShieldCheck } from "lucide-react";

import { verifiedKeyIn, withSignedCalls } from "../../model/braids/braid-draft.ts";

export function BraidCondition({ where }: { where: string | null }) {
  const verified = where ? verifiedKeyIn(where) : undefined;
  const rest =
    where && verified !== undefined ? withSignedCalls({ where, on: false, key: "" }) : where;
  const signed =
    verified !== undefined ? (
      <Badge
        size="sm"
        variant="subtle"
        colorPalette="green"
        flexShrink={0}
        title={`Only calls signed for “${verified}”`}
        data-testid="braid-condition-signed"
      >
        <ShieldCheck size={12} aria-hidden />
        Signed
      </Badge>
    ) : null;
  return (
    <HStack gap={2} align="start" minWidth={0}>
      {rest ? (
        <HighlightedExpression
          layout="block"
          maxLines={2}
          code={rest}
          data-testid="braid-condition-code"
        />
      ) : (
        <Text textStyle="sm" color="fg.muted">
          {signed ? "Every signed span" : "Every span"}
        </Text>
      )}
      {signed}
    </HStack>
  );
}

/**
 * Langy's suggestions in the widget editor: starting points for a new widget, or changes
 * that fit what this widget draws. Each one drafts in Langy for the member to send.
 */

import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";

import type { WidgetAsk } from "../../langy/model/board-langy.ts";

export function WidgetLangyAsks({
  asks,
  onAsk,
}: {
  asks: readonly WidgetAsk[];
  onAsk: (ask: WidgetAsk) => void;
}) {
  return (
    <HStack
      as="fieldset"
      aria-label="Ask Langy"
      gap={2}
      flexWrap="wrap"
      border="none"
      margin={0}
      padding={0}
      minWidth={0}
    >
      <HStack gap={1} color="purple.600" fontSize="12px" fontWeight="medium">
        <Sparkles size={13} aria-hidden />
        <Text as="span">Ask Langy</Text>
      </HStack>
      {asks.map((ask) => (
        <Button
          key={ask.ask}
          variant="outline"
          size="xs"
          borderRadius="full"
          borderColor="border"
          fontWeight="normal"
          title={ask.why}
          _hover={{ borderColor: "purple.300", background: "purple.50" }}
          onClick={() => onAsk(ask)}
        >
          {ask.ask}
        </Button>
      ))}
    </HStack>
  );
}

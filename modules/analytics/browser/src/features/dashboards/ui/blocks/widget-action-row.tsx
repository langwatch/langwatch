/**
 * The buttons a widget's catalogue definition declares under its chart (AC125, AC243), such as
 * Investigate and Propose a fix. Each drafts the widget's own prompt for it in Langy.
 */

import { Button, HStack } from "@langwatch/design-system/primitives";

import { type WidgetButtonAction, widgetActionLabel } from "../../langy/model/board-langy.ts";

/** The row's height: one extra-small button and the space under it. */
export const WIDGET_ACTION_ROW_HEIGHT_PX = 32;

export function WidgetActionRow({
  name,
  actions,
  onAction,
}: {
  name: string;
  actions: readonly WidgetButtonAction[];
  onAction: (action: WidgetButtonAction) => void;
}) {
  return (
    <HStack
      as="fieldset"
      aria-label={`Langy actions for ${name}`}
      border="none"
      margin={0}
      minWidth={0}
      height={`${WIDGET_ACTION_ROW_HEIGHT_PX}px`}
      paddingX={4}
      paddingTop={0}
      paddingBottom={1}
      gap={2}
      flexShrink={0}
    >
      {actions.map((action) => (
        <Button
          key={action.kind}
          variant="outline"
          size="xs"
          fontWeight="normal"
          onClick={() => onAction(action)}
        >
          {widgetActionLabel(action)}
        </Button>
      ))}
    </HStack>
  );
}

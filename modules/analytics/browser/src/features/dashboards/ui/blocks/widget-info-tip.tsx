/**
 * A widget's (i) on a board card, faint beside the title: hover or focus shows what the widget
 * is for and why it matters, so the card itself carries only the title.
 */

import { IconButton } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";

export function WidgetInfoTip({ name, description }: { name: string; description: string }) {
  return (
    <Tooltip
      content={description}
      showArrow
      positioning={{ placement: "bottom-start" }}
      contentProps={{ maxWidth: "xs", whiteSpace: "pre-line" }}
    >
      <IconButton
        aria-label={`About ${name}`}
        variant="ghost"
        size="xs"
        flexShrink={0}
        color="fg.subtle"
        opacity={0.7}
        _hover={{ opacity: 1, color: "fg", background: "bg.muted" }}
      >
        <Info size={13} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

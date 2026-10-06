/**
 * A widget's Ask Langy button on a board card: one click hands Langy a ready draft about
 * this widget, the same hand-off picking a widget gives (AC120).
 */

import { IconButton } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Sparkles } from "lucide-react";

export function AskLangyButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Tooltip content="Ask Langy" showArrow positioning={{ placement: "bottom-end" }}>
      <IconButton
        aria-label={`Ask Langy about ${name}`}
        variant="ghost"
        size="xs"
        color="fg.subtle"
        onClick={onClick}
      >
        <Sparkles size={13} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/** The pin that toggles a board in the member's Pinned list. Presentational. */

import { IconButton } from "@langwatch/design-system/primitives";
import { Pin } from "lucide-react";

export function BoardStar({
  isStarred,
  onToggle,
  size = 15,
}: {
  isStarred: boolean;
  onToggle: () => void;
  size?: number;
}) {
  const label = isStarred ? "Unpin dashboard" : "Pin dashboard";
  return (
    <IconButton
      variant="ghost"
      size="xs"
      minWidth={0}
      borderRadius="md"
      color={isStarred ? "yellow.solid" : "fg.subtle"}
      _hover={{ color: isStarred ? "yellow.solid" : "fg", background: "bg.muted" }}
      aria-label={label}
      aria-pressed={isStarred}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <Pin size={size} fill={isStarred ? "currentColor" : "none"} strokeWidth={1.9} aria-hidden />
    </IconButton>
  );
}

/**
 * The grip a sidebar row is reordered by from the keyboard: Space lifts the row, the arrows
 * move it and Space drops it. A pointer drags the whole row, so the grip is also a cue.
 */

import { IconButton } from "@langwatch/design-system/primitives";
import { GripVertical } from "lucide-react";
import type { KeyboardEventHandler, Ref } from "react";

export function RowDragHandle({
  name,
  handleRef,
  onKeyDown,
  describedBy,
}: {
  name: string;
  handleRef: Ref<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement> | undefined;
  /** The sortable list's instructions, read once the handle has focus. */
  describedBy: string | undefined;
}) {
  return (
    <IconButton
      ref={handleRef}
      size="xs"
      variant="ghost"
      minWidth="20px"
      height="20px"
      color="fg.subtle"
      cursor="grab"
      opacity={0}
      transition="opacity 0.15s"
      _hover={{ color: "fg", background: "transparent" }}
      aria-label={`Reorder ${name}`}
      aria-roledescription="sortable"
      aria-describedby={describedBy}
      data-drag-handle=""
      onKeyDown={onKeyDown}
    >
      <GripVertical size={14} aria-hidden />
    </IconButton>
  );
}

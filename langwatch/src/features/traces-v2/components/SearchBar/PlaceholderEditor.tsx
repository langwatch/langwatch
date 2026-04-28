import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect } from "react";

const PLACEHOLDER_TEXT = "Filter traces… type a field name or free text";

interface PlaceholderEditorProps {
  queryText: string;
  onActivate: () => void;
}

/**
 * Lightweight stand-in for the TipTap-backed editor. Mounted on cold load to
 * avoid the ~270ms ProseMirror init reflow. Activates (and tears itself down)
 * on first focus, click, or `/` keystroke — the parent then mounts the real
 * editor and forwards focus to it.
 */
export const PlaceholderEditor: React.FC<PlaceholderEditorProps> = ({
  queryText,
  onActivate,
}) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      onActivate();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onActivate]);

  const isEmpty = queryText.length === 0;

  return (
    <Box
      tabIndex={0}
      role="textbox"
      aria-label={PLACEHOLDER_TEXT}
      data-placeholder={PLACEHOLDER_TEXT}
      onFocus={onActivate}
      onMouseDown={onActivate}
      fontFamily="var(--chakra-fonts-mono)"
      fontSize="var(--chakra-font-sizes-xs)"
      lineHeight="1.5"
      outline="none"
      whiteSpace="nowrap"
      overflow="hidden"
      cursor="text"
      color={isEmpty ? "fg.subtle" : undefined}
    >
      {isEmpty ? PLACEHOLDER_TEXT : queryText}
    </Box>
  );
};

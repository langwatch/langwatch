/** Find unclosed {{ before cursor position for triggering the variable menu */
export const findUnclosedBraces = (
  text: string,
  cursorPos: number,
): { start: number; query: string } | null => {
  // Look backwards from cursor for {{
  const textBeforeCursor = text.substring(0, cursorPos);

  // Find the last {{ that doesn't have a matching }}
  let lastOpenBrace = -1;
  let i = textBeforeCursor.length - 1;

  while (i >= 1) {
    if (textBeforeCursor[i - 1] === "{" && textBeforeCursor[i] === "{") {
      // Found {{, check if there's a }} after it before cursor
      const afterBraces = textBeforeCursor.substring(i + 1);
      if (!afterBraces.includes("}}")) {
        lastOpenBrace = i + 1; // Position after {{
        break;
      }
    }
    i--;
  }

  if (lastOpenBrace === -1) return null;

  let query = textBeforeCursor.substring(lastOpenBrace);

  // Remove any trailing } characters (user may have typed partial closing braces)
  query = query.replace(/\}+$/, "");

  // Don't trigger if query has spaces (likely not a variable)
  if (query.includes(" ") || query.includes("\n")) return null;

  // Don't trigger if query contains } in the middle (malformed)
  if (query.includes("}")) return null;

  return { start: lastOpenBrace, query };
};

/** Find unclosed {% before cursor position for triggering the logic menu.
 *  Returns { start, query } where start is the position after {%
 *  and query is the trimmed keyword being typed.
 *  Returns null if no unclosed {% found, or if preceded by { (i.e. {{%).
 */
export const findUnclosedPercentBraces = (
  text: string,
  cursorPos: number,
): { start: number; query: string } | null => {
  const textBeforeCursor = text.substring(0, cursorPos);

  // Find the last {% that doesn't have a matching %}
  let lastOpenTag = -1;
  let i = textBeforeCursor.length - 1;

  while (i >= 1) {
    if (textBeforeCursor[i - 1] === "{" && textBeforeCursor[i] === "%") {
      // Check it's not preceded by another { (i.e. {{%)
      if (i >= 2 && textBeforeCursor[i - 2] === "{") {
        i--;
        continue;
      }

      // Found {%, check if there's a %} after it before cursor
      const afterTag = textBeforeCursor.substring(i + 1);
      if (!afterTag.includes("%}")) {
        lastOpenTag = i + 1; // Position after {%
        break;
      }
    }
    i--;
  }

  if (lastOpenTag === -1) return null;

  // Extract query: everything after {% up to cursor, trimmed of leading whitespace
  const rawQuery = textBeforeCursor.substring(lastOpenTag);
  const query = rawQuery.trimStart();

  // If the query contains a space, the user has already typed a keyword and is
  // now typing arguments (e.g., "for i in items"). Don't show the autocomplete.
  if (query.includes(" ")) return null;

  return { start: lastOpenTag, query };
};

/**
 * Calculate menu position coordinates from the current caret position.
 * Falls back to container-relative coordinates when caret position is unavailable.
 *
 * @param caretPositionRef - Ref to the current caret position from rich-textarea
 * @param containerRef - Ref to the container element for fallback positioning
 * @returns Coordinates { top, left } for positioning a popup menu
 */
export const getCaretCoordinates = ({
  caretPositionRef,
  containerRef,
}: {
  caretPositionRef: React.RefObject<
    | { focused: false; selectionStart: number; selectionEnd: number }
    | {
        focused: true;
        selectionStart: number;
        selectionEnd: number;
        top: number;
        left: number;
        height: number;
      }
    | null
  >;
  containerRef: React.RefObject<HTMLElement | null>;
}): { top: number; left: number } => {
  const pos = caretPositionRef.current;
  if (pos?.focused) {
    return {
      top: pos.top + pos.height + 4,
      left: pos.left,
    };
  }

  // Fallback: use container position
  const containerRect = containerRef.current?.getBoundingClientRect();
  return {
    top: (containerRect?.top ?? 0) + 30,
    left: (containerRect?.left ?? 0) + 10,
  };
};

/** Line height for borderless mode (used for paragraph calculations) */
export const BORDERLESS_LINE_HEIGHT = 28;

/**
 * Replace textarea content in an undo-able way using execCommand.
 * This integrates with the browser's native undo stack (Ctrl+Z).
 *
 * @param textarea - The textarea element
 * @param newValue - The new complete value for the textarea
 * @param cursorPosition - Optional cursor position after the change
 */
export const setTextareaValueUndoable = (
  textarea: HTMLTextAreaElement,
  newValue: string,
  cursorPosition?: number,
): void => {
  // Focus and select all text
  textarea.focus();
  textarea.select();

  // Use execCommand to replace - this is tracked by browser undo stack
  // Note: execCommand is deprecated but still works and is the only way
  // to integrate with the native undo stack
  document.execCommand("insertText", false, newValue);

  // Set cursor position if provided
  if (cursorPosition !== undefined) {
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  }
};

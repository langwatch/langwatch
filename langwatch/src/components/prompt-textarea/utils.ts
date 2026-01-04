/** Regex for matching variables in the format {{variable_name}} */
export const VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;

/** Extract variable names from text */
export const parseVariablesFromText = (text: string): string[] => {
  const matches = text.match(VARIABLE_REGEX);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.slice(2, -2)))); // Remove {{ and }}
};

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

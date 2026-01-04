/** Regex for matching variables in the format {{variable_name}} */
export const VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;

/** Extract variable names from text */
export const parseVariablesFromText = (text: string): string[] => {
  const matches = text.match(VARIABLE_REGEX);
  if (!matches) return [];
  return matches.map((m) => m.slice(2, -2)); // Remove {{ and }}
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

